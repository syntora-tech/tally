import { describe, expect, it } from 'vitest';
import { WorkCalendar } from './calendar';
import { defaultActDate, defaultInvoiceDate, dueDate, payoutDeadline } from './date-rules';
import { parseLocalDate, type LocalDate } from './local-date';

const d = (s: string): LocalDate => parseLocalDate(s)._unsafeUnwrap();
const plain = new WorkCalendar();
const withNewYear = new WorkCalendar([{ date: d('2027-01-01'), isWorking: false }]);

describe('WorkCalendar', () => {
  it('uses Mon–Fri unless an exception overrides it', () => {
    expect(plain.isWorkingDay(d('2026-10-01'))).toBe(true); // holiday, but a working day (5.5)
    expect(plain.isWorkingDay(d('2026-10-31'))).toBe(false);
    expect(withNewYear.isWorkingDay(d('2027-01-01'))).toBe(false);
    expect(
      new WorkCalendar([{ date: d('2026-10-31'), isWorking: true }]).isWorkingDay(d('2026-10-31')),
    ).toBe(true);
  });

  it('computes the period norm: July 2026 = 184 h (spec 6.4, 9.1)', () => {
    expect(plain.workHoursInMonth(d('2026-07-01'))).toBe(184);
    expect(plain.workHoursInMonth(d('2026-08-01'))).toBe(168);
  });

  it('adds working days and finds neighbours', () => {
    expect(plain.nextWorkingDayOnOrAfter(d('2026-09-20'))).toBe('2026-09-21');
    expect(plain.addWorkingDays(d('2026-09-18'), 1)).toBe('2026-09-21');
    expect(plain.addWorkingDays(d('2026-09-21'), 0)).toBe('2026-09-21');
    expect(plain.previousWorkingDayOnOrBefore(d('2026-10-31'))).toBe('2026-10-30');
  });
});

describe('default document dates (spec 5.5 table)', () => {
  const lastDay = { type: 'last_working_day_of_period' } as const;
  const firstAfter = { type: 'first_working_day_after_period' } as const;

  it.each([
    ['2026-09-01', '2026-09-30', '2026-10-01'],
    ['2026-10-01', '2026-10-30', '2026-11-02'],
    ['2026-11-01', '2026-11-30', '2026-12-01'],
    ['2026-12-01', '2026-12-31', '2027-01-01'],
  ])('period %s → act %s, invoice %s', (period, act, invoice) => {
    expect(defaultActDate(lastDay, d(period), plain)).toBe(act);
    expect(defaultInvoiceDate(firstAfter, d(period), plain)).toBe(invoice);
  });

  it('an exception on 01.01.2027 moves the December invoice to 04.01.2027', () => {
    expect(defaultInvoiceDate(firstAfter, d('2026-12-01'), withNewYear)).toBe('2027-01-04');
  });

  it('supports the n-th working day and manual act dates', () => {
    expect(
      defaultActDate({ type: 'nth_working_day_after_period', n: 3 }, d('2026-10-01'), plain),
    ).toBe('2026-11-04');
    expect(
      defaultInvoiceDate({ type: 'nth_working_day_after_period', n: 2 }, d('2026-09-01'), plain),
    ).toBe('2026-10-02');
    expect(defaultActDate({ type: 'manual' }, d('2026-10-01'), plain)).toBeNull();
  });
});

describe('due date and payout deadline (spec 5.3)', () => {
  it('invoice 01.09.2026, due the 20th → 20.09 (Sunday) → deadline Monday 21.09', () => {
    const due = dueDate({ type: 'day_of_month', day: 20 }, d('2026-09-01'), plain);
    expect(due).toBe('2026-09-20');
    expect(payoutDeadline(due, 0, plain)).toBe('2026-09-21');
    expect(payoutDeadline(due, 2, plain)).toBe('2026-09-23');
  });

  it('rolls day_of_month to the next month when the invoice is later, clamping short months', () => {
    expect(dueDate({ type: 'day_of_month', day: 20 }, d('2026-09-25'), plain)).toBe('2026-10-20');
    expect(dueDate({ type: 'day_of_month', day: 31 }, d('2026-02-03'), plain)).toBe('2026-02-28');
    expect(dueDate({ type: 'day_of_month', day: 20 }, d('2026-09-20'), plain)).toBe('2026-09-20');
  });

  it('net_days counts calendar days', () => {
    expect(dueDate({ type: 'net_days', days: 15 }, d('2026-09-01'), plain)).toBe('2026-09-16');
  });

  it('net_working_days skips weekends and calendar exceptions (IdeaSoft, A-072)', () => {
    // Tue 01.09.2026 + 15 working days → Tue 22.09.2026.
    expect(dueDate({ type: 'net_working_days', days: 15 }, d('2026-09-01'), plain)).toBe(
      '2026-09-22',
    );
    // An invoice issued on Friday starts counting on Monday.
    expect(dueDate({ type: 'net_working_days', days: 1 }, d('2026-09-04'), plain)).toBe(
      '2026-09-07',
    );
    const holiday = new WorkCalendar([{ date: d('2026-09-10'), isWorking: false }]);
    expect(dueDate({ type: 'net_working_days', days: 15 }, d('2026-09-01'), holiday)).toBe(
      '2026-09-23',
    );
  });
});
