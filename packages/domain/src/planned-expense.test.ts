import { describe, expect, it } from 'vitest';
import { parseLocalDate, type LocalDate } from './local-date';
import { plannedExpenseDates, type PlannedExpenseTerms } from './planned-expense';

const d = (s: string) => parseLocalDate(s)._unsafeUnwrap();
const terms = (over: Partial<PlannedExpenseTerms>): PlannedExpenseTerms => ({
  frequency: 'monthly',
  anchorMonth: null,
  dueDay: null,
  startsOn: d('2026-01-01'),
  endsOn: null,
  ...over,
});
const dates = (e: PlannedExpenseTerms, from: string, count: number): LocalDate[] =>
  plannedExpenseDates(e, d(from), count);

describe('plannedExpenseDates (A-067)', () => {
  it('repeats a monthly expense on its day, clamped to the month end', () => {
    expect(dates(terms({ dueDay: 31 }), '2026-01-15', 3)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('keeps to the start and end months', () => {
    const e = terms({ startsOn: d('2026-03-01'), endsOn: d('2026-04-30'), dueDay: 5 });
    expect(dates(e, '2026-01-01', 6)).toEqual(['2026-03-05', '2026-04-05']);
  });

  it('falls once a year in the anchor month', () => {
    const e = terms({ frequency: 'yearly', anchorMonth: 2, dueDay: 10 });
    expect(dates(e, '2026-10-01', 6)).toEqual(['2027-02-10']);
  });

  it('falls every three months from the anchor month', () => {
    const e = terms({ frequency: 'quarterly', anchorMonth: 11, dueDay: 19 });
    expect(dates(e, '2026-10-01', 6)).toEqual(['2026-11-19', '2027-02-19']);
  });
});
