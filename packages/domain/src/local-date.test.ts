import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  compareLocalDate,
  daysInMonth,
  diffDays,
  endOfMonth,
  formatUaDate,
  isoDayOfWeek,
  isWeekend,
  localDate,
  localDateInZone,
  parseLocalDate,
  parseUaDate,
  startOfMonth,
  type LocalDate,
} from './local-date';

const d = (s: string): LocalDate => parseLocalDate(s)._unsafeUnwrap();

describe('parsing', () => {
  it('parses valid ISO dates', () => {
    expect(parseLocalDate('2026-09-29')._unsafeUnwrap()).toBe('2026-09-29');
  });

  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '2026-9-1', '29.09.2026', ''])(
    'rejects %j',
    (input) => {
      expect(parseLocalDate(input).isErr()).toBe(true);
    },
  );

  it('accepts leap days', () => {
    expect(parseLocalDate('2028-02-29').isOk()).toBe(true);
  });

  it('parses the UI format', () => {
    expect(parseUaDate('31.12.2026')._unsafeUnwrap()).toBe('2026-12-31');
    expect(parseUaDate('31.02.2026').isErr()).toBe(true);
  });

  it('localDate throws on impossible dates', () => {
    expect(() => localDate(2026, 2, 30)).toThrow();
  });
});

describe('day of week (spec 5.3, 5.5 examples)', () => {
  it.each([
    ['2026-09-01', 2], // invoice date, Tuesday
    ['2026-09-20', 7], // due date, Sunday
    ['2026-09-21', 1], // payout deadline, Monday
    ['2026-10-31', 6],
    ['2027-01-01', 5],
    ['1970-01-01', 4],
    ['1969-12-31', 3],
  ])('%s → isodow %i', (date, dow) => {
    expect(isoDayOfWeek(d(date))).toBe(dow);
  });

  it('detects weekends', () => {
    expect(isWeekend(d('2026-02-28'))).toBe(true);
    expect(isWeekend(d('2026-09-30'))).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds days across months, years and DST switches', () => {
    expect(addDays(d('2026-10-31'), 1)).toBe('2026-11-01');
    expect(addDays(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(d('2026-03-29'), 1)).toBe('2026-03-30');
    expect(addDays(d('2026-03-01'), -1)).toBe('2026-02-28');
  });

  it('diffs days', () => {
    expect(diffDays(d('2026-09-01'), d('2026-09-21'))).toBe(20);
    expect(diffDays(d('2026-09-21'), d('2026-09-01'))).toBe(-20);
  });

  it('computes month boundaries', () => {
    expect(startOfMonth(d('2026-07-15'))).toBe('2026-07-01');
    expect(endOfMonth(d('2026-02-10'))).toBe('2026-02-28');
    expect(endOfMonth(d('2028-02-10'))).toBe('2028-02-29');
    expect(daysInMonth(2026, 9)).toBe(30);
  });

  it('adds months to month starts', () => {
    expect(addMonths(d('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addMonths(d('2026-01-15'), -1)).toBe('2025-12-01');
    expect(addMonths(d('2026-08-01'), 13)).toBe('2027-09-01');
  });

  it('compares', () => {
    expect(compareLocalDate(d('2026-09-01'), d('2026-09-02'))).toBe(-1);
    expect(compareLocalDate(d('2026-09-02'), d('2026-09-02'))).toBe(0);
    expect(compareLocalDate(d('2026-10-01'), d('2026-09-30'))).toBe(1);
  });
});

describe('formatting and zones', () => {
  it('formats as ДД.ММ.РРРР', () => {
    expect(formatUaDate(d('2026-01-04'))).toBe('04.01.2026');
  });

  it('resolves the Kyiv calendar date of an instant', () => {
    expect(localDateInZone(new Date('2026-09-29T22:30:00Z'))).toBe('2026-09-30');
    expect(localDateInZone(new Date('2026-09-29T20:59:00Z'))).toBe('2026-09-29');
    expect(localDateInZone(new Date('2026-12-31T22:00:00Z'))).toBe('2027-01-01');
    expect(localDateInZone(new Date('2026-09-29T22:30:00Z'), 'UTC')).toBe('2026-09-29');
  });
});
