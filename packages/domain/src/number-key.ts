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
