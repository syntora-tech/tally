import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createDb } from '@tally/db';
import { aliasesSchema } from './aliases';
import { parseTrips } from './sources/trips';
import { buildTripsModel } from './trips';
import { writeTrips, type TripsOutcome } from './trips-writer';
import { readBook } from './workbook';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'data/legacy' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const cwd = process.env.INIT_CWD ?? process.cwd();
const dir = isAbsolute(values.dir) ? values.dir : resolve(cwd, values.dir);
const dryRun = values['dry-run'];

function report(model: ReturnType<typeof buildTripsModel>, outcome: TripsOutcome | null): string {
  const lines = [
    `# Імпорт поїздок${dryRun ? ' (dry-run)' : ''}`,
    '',
    `Створено: ${new Date().toISOString()}`,
    '',
    '## Поїздки',
    '',
    '| Аркуш | Назва | Учасник | Дати | Витрат | До компенсації, UAH | Компенсовано, UAH | Як |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...model.trips.map((t) => {
      const total = outcome?.totals.find((x) => x.sheet === t.sheet);
      const dates = t.startsOn && t.endsOn ? `${t.startsOn} — ${t.endsOn}` : 'уточнити';
      return `| ${t.sheet} | ${t.title} | ${t.participant} | ${dates} | ${String(t.expenses.length)} | ${total?.dueUah ?? '—'} | ${total?.reimbursedUah ?? '—'} | ${total?.note ?? '—'} |`;
    }),
    '',
    '## Для перевірки',
    '',
    ...(model.anomalies.length || outcome?.problems.length
      ? [
          ...model.anomalies.map((a) => `- ${a.code} ${a.ref}: ${a.message}`),
          ...(outcome?.problems ?? []).map((p) => `- ${p}`),
        ]
      : ['- немає']),
    '',
    '## Записи',
    '',
    ...Object.entries(outcome?.stats ?? {}).map(
      ([table, s]) =>
        `- ${table}: +${String(s.inserted)}, змінено ${String(s.updated)}, без змін ${String(s.unchanged)}`,
    ),
    '',
  ];
  return lines.join('\n');
}

async function main(): Promise<number> {
  const file = readdirSync(dir).find((f) => /trip/i.test(f) && f.toLowerCase().endsWith('.xlsx'));
  if (!file) {
    console.error(`Не знайдено файлу поїздок у ${dir}`);
    return 1;
  }
  const aliasesPath = join(dir, 'aliases.json');
  if (!existsSync(aliasesPath)) {
    console.error(`Немає ${aliasesPath}`);
    return 1;
  }
  const aliases = aliasesSchema.parse(JSON.parse(readFileSync(aliasesPath, 'utf8')));
  const model = buildTripsModel(parseTrips(readBook(join(dir, file), 'trips')), aliases);
  if (model.unmapped.length) {
    console.error(`Аркуші без опису в aliases.json → trips: ${model.unmapped.join(', ')}`);
    if (!dryRun) return 1;
  }
  const url =
    process.env.DIRECT_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const { db, sql } = createDb(url, { max: 1 });
  let outcome: TripsOutcome;
  try {
    outcome = await writeTrips(db, model, { dryRun });
  } finally {
    await sql.end();
  }
  const reportPath = join(dir, 'import-trips-report.md');
  writeFileSync(reportPath, report(model, outcome));
  console.log(`Звіт: ${reportPath}`);
  console.log(dryRun ? 'Dry-run завершено, зміни відкочено.' : 'Імпорт поїздок завершено.');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
