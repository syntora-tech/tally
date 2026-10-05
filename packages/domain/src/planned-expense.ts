import {
  addMonths,
  daysInMonth,
  localDate,
  startOfMonth,
  toParts,
  type LocalDate,
} from './local-date';

export type PlannedFrequency = 'monthly' | 'quarterly' | 'yearly';

export type PlannedExpenseTerms = {
  frequency: PlannedFrequency;
  /** First month of the cycle (1–12) for quarterly and yearly expenses. */
  anchorMonth: number | null;
  /** Day of the month the money goes out; past the month's end it falls on its last day. */
  dueDay: number | null;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
};

function dueInMonth(e: PlannedExpenseTerms, month: number): boolean {
  if (e.frequency === 'monthly') return true;
  const anchor = e.anchorMonth ?? 1;
  const step = e.frequency === 'quarterly' ? 3 : 12;
  return (((month - anchor) % step) + step) % step === 0;
}

/**
 * Dates a planned expense falls on in `count` months starting with the month of `from`
 * (A-067). The start and end are month-inclusive.
 */
export function plannedExpenseDates(
  e: PlannedExpenseTerms,
  from: LocalDate,
  count: number,
): LocalDate[] {
  const first = startOfMonth(e.startsOn);
  const last = e.endsOn ? startOfMonth(e.endsOn) : null;
  const dates: LocalDate[] = [];
  for (let i = 0; i < count; i++) {
    const month = addMonths(startOfMonth(from), i);
    if (month < first || (last !== null && month > last)) continue;
    const { year, month: m } = toParts(month);
    if (!dueInMonth(e, m)) continue;
    dates.push(localDate(year, m, Math.min(e.dueDay ?? 1, daysInMonth(year, m))));
  }
  return dates;
}
