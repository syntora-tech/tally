import {
  addDays,
  addMonths,
  daysInMonth,
  endOfMonth,
  isWeekend,
  localDate,
  startOfMonth,
  toParts,
  type LocalDate,
} from './local-date';

export type CalendarException = { date: LocalDate; isWorking: boolean };

/**
 * Working days = Mon–Fri unless an exception says otherwise (spec 5.5). Public holidays are not
 * hard-coded: under martial law they are working days, so owners maintain exceptions manually.
 */
export class WorkCalendar {
  private readonly exceptions: Map<string, boolean>;

  constructor(exceptions: Iterable<CalendarException> = []) {
    this.exceptions = new Map([...exceptions].map((e) => [e.date, e.isWorking]));
  }

  isWorkingDay(date: LocalDate): boolean {
    return this.exceptions.get(date) ?? !isWeekend(date);
  }

  nextWorkingDayOnOrAfter(date: LocalDate): LocalDate {
    let d = date;
    // A year of consecutive non-working exceptions would be a data error; fail loudly.
    for (let i = 0; i < 366; i++) {
      if (this.isWorkingDay(d)) return d;
      d = addDays(d, 1);
    }
    throw new Error(`No working day within a year after ${date}`);
  }

  previousWorkingDayOnOrBefore(date: LocalDate): LocalDate {
    let d = date;
    for (let i = 0; i < 366; i++) {
      if (this.isWorkingDay(d)) return d;
      d = addDays(d, -1);
    }
    throw new Error(`No working day within a year before ${date}`);
  }

  /** `date` plus `n` working days (n ≥ 0); n = 0 returns `date` unchanged. */
  addWorkingDays(date: LocalDate, n: number): LocalDate {
    let d = date;
    for (let left = n; left > 0;) {
      d = addDays(d, 1);
      if (this.isWorkingDay(d)) left--;
    }
    return d;
  }

  lastWorkingDayOfMonth(month: LocalDate): LocalDate {
    return this.previousWorkingDayOnOrBefore(endOfMonth(month));
  }

  /** n-th working day after the month ends: n = 1 is the first working day of the next month. */
  nthWorkingDayAfterMonth(month: LocalDate, n: number): LocalDate {
    const first = this.nextWorkingDayOnOrAfter(addMonths(month, 1));
    return this.addWorkingDays(first, n - 1);
  }

  workingDaysInMonth(month: LocalDate): number {
    const { year, month: m } = toParts(month);
    let count = 0;
    for (let day = 1; day <= daysInMonth(year, m); day++) {
      if (this.isWorkingDay(localDate(year, m, day))) count++;
    }
    return count;
  }

  /** Period norm: working days × 8 (spec 6.4; July 2026 = 184). */
  workHoursInMonth(month: LocalDate): number {
    return this.workingDaysInMonth(startOfMonth(month)) * 8;
  }
}
