import { toDecimal, type LocalDate } from '@tally/domain';
import { decimal, text } from '../cells';
import { ref, type Book } from '../workbook';
import { excelDate } from './ledger';

export type RegistryAct = {
  ref: string;
  contractor: string;
  actDate: LocalDate;
  number: string;
  amountUah: string;
};

/**
 * `Реестр актов` → `ФОПы акты` (spec 8.1): contractor, date, number verbatim (A8: `1003  -А4`),
 * amount. Subtotal rows have only an amount and are skipped.
 */
export function parseActRegistry(book: Book): { acts: RegistryAct[]; problems: string[] } {
  const sheet = [...book.sheets.values()].find((s) => /акты|акти/i.test(s.name));
  if (!sheet) return { acts: [], problems: ['Немає аркуша «ФОПы акты»'] };
  const acts: RegistryAct[] = [];
  const problems: string[] = [];
  sheet.rows.forEach((row, r) => {
    if (r === 0) return;
    const contractor = text(row[0]?.v);
    const number = typeof row[2]?.v === 'string' ? row[2].v.trim() : text(row[2]?.v);
    if (!contractor || !number) return;
    const actDate = excelDate(row[1]?.v);
    const amount = decimal(row[3]?.v);
    if (!actDate || amount === null) {
      problems.push(`${ref(sheet, r)}: акт ${number} без дати або суми`);
      return;
    }
    acts.push({
      ref: ref(sheet, r),
      contractor,
      actDate,
      number,
      amountUah: toDecimal(amount).toDecimalPlaces(2).toString(),
    });
  });
  return { acts, problems };
}

/** Contract number behind an act number: `1003 - А4` → `OD-1003`, `MF281025/7` → `MF281025`. */
export function contractOfActNumber(number: string): string | null {
  const od = /^(\d{4})\s*-\s*[АA]\s*\d+$/.exec(number);
  if (od?.[1]) return `OD-${od[1]}`;
  const slash = /^([A-Z]+\d+)\/\d+$/.exec(number);
  return slash?.[1] ?? null;
}

/** Sequence template and counter of a contract's act numbers (spec 5.6, Q14: format kept). */
export function actSequence(numbers: readonly string[]) {
  const parsed = numbers
    .map((n) => {
      const od = /^(\d{4})\s*-\s*[АA]\s*(\d+)$/.exec(n);
      if (od?.[1] && od[2]) return { template: `${od[1]} - А{seq}`, seq: Number(od[2]) };
      const slash = /^([A-Z]+\d+)\/(\d+)$/.exec(n);
      if (slash?.[1] && slash[2]) return { template: `${slash[1]}/{seq}`, seq: Number(slash[2]) };
      return null;
    })
    .filter((x): x is { template: string; seq: number } => x !== null);
  const first = parsed[0];
  if (!first) return null;
  return { template: first.template, nextValue: Math.max(...parsed.map((p) => p.seq)) + 1 };
}
