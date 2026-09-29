import { addDays, daysInMonth, isWeekend, localDate, toParts, type LocalDate } from './local-date';

/**
 * Mon–Fri days × 8 for the month of `date`. Stage 1 approximation for "margin by terms"
 * (assumptions A-015); stage 2 replaces it with WorkCalendar that honours exceptions.
 */
export function weekdayHoursInMonth(date: LocalDate): number {
  const { year, month } = toParts(date);
  let day = localDate(year, month, 1);
  let workdays = 0;
  for (let i = 0; i < daysInMonth(year, month); i++) {
    if (!isWeekend(day)) workdays++;
    day = addDays(day, 1);
  }
  return workdays * 8;
}
