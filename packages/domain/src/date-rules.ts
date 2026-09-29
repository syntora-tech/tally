import type { WorkCalendar } from './calendar';
import {
  addDays,
  addMonths,
  compareLocalDate,
  daysInMonth,
  localDate,
  startOfMonth,
  toParts,
  type LocalDate,
} from './local-date';

// Contract rules (spec 5.5), stored as JSON on `contract`.
export type ActDateRule =
  | { type: 'last_working_day_of_period' }
  | { type: 'nth_working_day_after_period'; n: number }
  | { type: 'manual' };

export type InvoiceDateRule =
  { type: 'first_working_day_after_period' } | { type: 'nth_working_day_after_period'; n: number };

export type PaymentDueRule =
  { type: 'day_of_month'; day: number } | { type: 'net_days'; days: number };

/** Default act date for a period, or null when the contract requires a manual date. */
export function defaultActDate(
  rule: ActDateRule,
  period: LocalDate,
  cal: WorkCalendar,
): LocalDate | null {
  switch (rule.type) {
    case 'last_working_day_of_period':
      return cal.lastWorkingDayOfMonth(period);
    case 'nth_working_day_after_period':
      return cal.nthWorkingDayAfterMonth(period, rule.n);
    case 'manual':
      return null;
  }
}

export function defaultInvoiceDate(
  rule: InvoiceDateRule,
  period: LocalDate,
  cal: WorkCalendar,
): LocalDate {
  return cal.nthWorkingDayAfterMonth(
    period,
    rule.type === 'first_working_day_after_period' ? 1 : rule.n,
  );
}

/**
 * Due date from the invoice date. `day_of_month`: that day of the invoice month, or of the next
 * month if the invoice is issued after it (assumptions); short months clamp to their last day.
 * Due dates are calendar dates; only the payout deadline moves to a working day (5.3).
 */
export function dueDate(rule: PaymentDueRule, invoiceDate: LocalDate): LocalDate {
  if (rule.type === 'net_days') return addDays(invoiceDate, rule.days);
  const inMonth = (month: LocalDate) => {
    const { year, month: m } = toParts(month);
    return localDate(year, m, Math.min(rule.day, daysInMonth(year, m)));
  };
  const candidate = inMonth(startOfMonth(invoiceDate));
  return compareLocalDate(candidate, invoiceDate) >= 0
    ? candidate
    : inMonth(addMonths(invoiceDate, 1));
}

/** Payout deadline (5.3): next working day on/after due, plus grace working days. */
export function payoutDeadline(due: LocalDate, graceDays: number, cal: WorkCalendar): LocalDate {
  return cal.addWorkingDays(cal.nextWorkingDayOnOrAfter(due), graceDays);
}
