/**
 * Search key for document numbers (spec 5.6): no whitespace or dashes, upper case, Latin A → Cyrillic А.
 * Must stay identical to the `number_key` generated column in SQL.
 */
export function numberKey(number: string): string {
  return number.replace(/[\s-]/g, '').toUpperCase().replaceAll('A', 'А');
}

/**
 * Preview of the next number of a sequence (spec 5.6). Mirrors `issue_number()` in SQL, which
 * alone issues real numbers; tokens: {seq} {yy} {yyyy} {contract}.
 */
export function formatSequenceNumber(
  template: string,
  value: number,
  year: number,
  contractNumber = '',
): string {
  return template
    .replaceAll('{seq}', String(value))
    .replaceAll('{yyyy}', String(year))
    .replaceAll('{yy}', String(year % 100).padStart(2, '0'))
    .replaceAll('{contract}', contractNumber);
}

/** The counter of an issued number: its last group of digits (`OD-1002-А12` → 12). */
export function sequenceValueOf(number: string): number | null {
  const m = /(\d+)\D*$/.exec(number);
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * An issued number written in the sequence's current format under the same counter (A-119), or null
 * when it already is, or when the format does not end with the counter (it could not be checked).
 */
export function renumberedInFormat(
  number: string,
  template: string,
  year: number,
  contractNumber = '',
): string | null {
  const tail = template.split('{seq}');
  if (tail.length < 2 || /[\d{]/.test(tail.at(-1) ?? '')) return null;
  const value = sequenceValueOf(number);
  if (value === null) return null;
  const next = formatSequenceNumber(template, value, year, contractNumber);
  return next !== number && sequenceValueOf(next) === value ? next : null;
}
