/**
 * Search key for document numbers (spec 5.6): no whitespace or dashes, upper case, Latin A → Cyrillic А.
 * Must stay identical to the `number_key` generated column in SQL.
 */
export function numberKey(number: string): string {
  return number.replace(/[\s-]/g, '').toUpperCase().replaceAll('A', 'А');
}
