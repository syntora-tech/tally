const MONTHS = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

/** "2026-07-01" → "Липень 2026". */
export function monthTitle(isoDate: string): string {
  const [year, month] = isoDate.split('-');
  return `${MONTHS[Number(month) - 1] ?? month ?? ''} ${year ?? ''}`;
}
