import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDb } from '@tally/db';
import {
  addMonths,
  defaultInvoiceDate,
  localDateInZone,
  parseLocalDate,
  startOfMonth,
  type LocalDate,
  WorkCalendar,
} from '@tally/domain';
import { aliasesSchema, draftAliases } from './aliases';
import { buildModel } from './model';
import { renderReport } from './report';
import { parseBench } from './sources/bench';
import { parseCalc } from './sources/calc';
import { parseHeaders } from './sources/headers';
import { loadBooks } from './workbook';
import { writeModel } from './writer';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'data/legacy' },
    'dry-run': { type: 'boolean', default: false },
    'write-aliases-draft': { type: 'boolean', default: false },
    /** Comma-separated YYYY-MM; default is the current and previous month (Europe/Kyiv). */
    'hours-months': { type: 'string' },
    /** YYYY-MM-DD for legacy invoices (A-046); default: first working day of the current month. */
    'legacy-invoice-date': { type: 'string' },
  },
});

// pnpm --filter runs in the package dir; resolve paths from where the command was typed.
const cwd = process.env.INIT_CWD ?? process.cwd();
const dir = isAbsolute(values.dir) ? values.dir : resolve(cwd, values.dir);
const dryRun = values['dry-run'];

function hoursMonths(): LocalDate[] {
  if (values['hours-months']) {
    return values['hours-months']
      .split(',')
      .map((m) => parseLocalDate(`${m.trim()}-01`)._unsafeUnwrap());
  }
  const today = process.env.APP_TODAY
    ? parseLocalDate(process.env.APP_TODAY)._unsafeUnwrap()
    : localDateInZone(new Date());
  const current = startOfMonth(today);
  return [addMonths(current, -1), current];
}

async function main(): Promise<number> {
  const books = loadBooks(dir);
  if (!books.bench || !books.calc) {
    console.error(`Не знайдено файлів у ${dir}: ${books.missing.join(', ')}`);
    return 1;
  }
  const benchSheet = books.bench.sheets.get('Bench');
  const bench = benchSheet
    ? parseBench(benchSheet)
    : { rows: [], problems: ['Немає аркуша Bench'] };
  const calc = parseCalc(books.calc);
  const { invoices, acts } = parseHeaders(books.calc);
  const sources = { bench: bench.rows, calc: calc.rows, invoices, acts };

  const draftPath = join(dir, 'aliases.draft.json');
  if (values['write-aliases-draft']) {
    writeFileSync(draftPath, `${JSON.stringify(draftAliases(sources), null, 2)}\n`);
    console.log(`Чернетку збережено: ${draftPath}. Перевірте й збережіть як aliases.json.`);
  }

  const aliasesPath = join(dir, 'aliases.json');
  if (!existsSync(aliasesPath)) {
    console.error(
      `Немає ${aliasesPath}. Запустіть з --write-aliases-draft, перевірте чернетку й перейменуйте.`,
    );
    return 1;
  }
  const aliases = aliasesSchema.parse(JSON.parse(readFileSync(aliasesPath, 'utf8')));
  const months = hoursMonths();
  console.log(`Години за: ${months.map((m) => m.slice(0, 7)).join(', ')}`);
  const legacyInvoiceDate = values['legacy-invoice-date']
    ? parseLocalDate(values['legacy-invoice-date'])._unsafeUnwrap()
    : defaultInvoiceDate(
        { type: 'first_working_day_after_period' },
        months[0] ?? startOfMonth(localDateInZone(new Date())),
        new WorkCalendar([]),
      );
  const model = buildModel(sources, aliases, { hoursMonths: months, legacyInvoiceDate });
  const problems = [...bench.problems, ...calc.problems];
  const unmapped = Object.values(model.unmapped).flat();

  // A real import needs every name mapped; dry-run still validates everything else.
  let stats = null;
  if (unmapped.length === 0 || dryRun) {
    const url =
      process.env.DIRECT_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    const { db, sql } = createDb(url, { max: 1 });
    try {
      stats = unmapped.length === 0 ? await writeModel(db, model, { dryRun }) : null;
    } finally {
      await sql.end();
    }
  }

  const reportPath = join(dir, 'import-report.md');
  writeFileSync(
    reportPath,
    renderReport({ model, stats, dryRun, problems, generatedAt: new Date().toISOString() }),
  );
  console.log(`Звіт: ${reportPath}`);
  if (unmapped.length) {
    console.error(`Незмаплені імена (${unmapped.length}): ${unmapped.join(', ')}`);
    return dryRun ? 0 : 1;
  }
  console.log(dryRun ? 'Dry-run завершено, зміни відкочено.' : 'Імпорт завершено.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
