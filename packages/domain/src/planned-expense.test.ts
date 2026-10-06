import { describe, expect, it } from 'vitest';
import { parseLocalDate, type LocalDate } from './local-date';
import {
  chargeOn,
  plannedExpenseDates,
  plannedMonthPayments,
  transferFee,
  type Convert,
  type PlannedExpenseTerms,
} from './planned-expense';

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

describe('planned payments (A-082)', () => {
  const pit = {
    id: 'pit',
    name: 'PIT',
    mode: 'withheld' as const,
    ratePercent: '18',
    currency: null,
    startsOn: d('2026-01-01'),
    endsOn: null,
    feeFixed: '5',
  };
  const levy = { ...pit, id: 'levy', name: 'Military levy', ratePercent: '5' };
  const esv = { ...pit, id: 'esv', name: 'ESV', mode: 'on_top' as const, ratePercent: '22' };
  const salary = {
    ...terms({ startsOn: d('2026-08-01') }),
    name: 'Director salary',
    amount: '11401.68',
    currency: 'UAH',
  };
  const parts = [
    { id: 'adv', name: 'Advance', amount: '5500', dueDay: 22, monthOffset: 0 },
    { id: 'rest', name: 'Rest', amount: null, dueDay: 7, monthOffset: 1 },
  ];

  it("reproduces the director's salary for August 2026", () => {
    const [advance, rest] = plannedMonthPayments(salary, parts, [pit, levy, esv], d('2026-08-01'));
    expect(advance).toMatchObject({ dueOn: '2026-08-22', fee: null });
    expect(advance?.net.toFixed(2)).toBe('4235.00');
    expect(rest?.dueOn).toBe('2026-09-07');
    expect(rest?.gross.toFixed(2)).toBe('5901.68');
    expect(rest?.net.toFixed(2)).toBe('4544.30');
    expect(
      rest?.charges.map((c) => [c.name, c.amount.toFixed(2), c.fee?.amount.toFixed(2)]),
    ).toEqual([
      ['PIT', '1062.30', '5.00'],
      ['Military levy', '295.08', '5.00'],
      ['ESV', '1298.37', '5.00'],
    ]);
  });

  it('pays the whole amount once without parts and skips months it is not due', () => {
    const yearly = { ...salary, frequency: 'yearly' as const, anchorMonth: 3, dueDay: 31 };
    expect(plannedMonthPayments(yearly, [], [], d('2026-08-01'))).toEqual([]);
    const [once] = plannedMonthPayments({ ...salary, dueDay: 31 }, [], [], d('2026-09-01'));
    expect(once).toMatchObject({ partId: null, name: 'Director salary', dueOn: '2026-09-30' });
  });

  it('charges a payout in another currency at the given rate, with the fee as a tariff', () => {
    const toUah: Convert = (a, from, to) => (from === 'USD' && to === 'UAH' ? a.times(41.5) : null);
    const tax = { ratePercent: '20', currency: 'UAH' };
    expect(chargeOn(tax, '3000', 'USD', toUah)?.amount.toFixed(2)).toBe('24900.00');
    expect(chargeOn(tax, '3000', 'USD')).toBeNull();
    const swift = { feeFixed: '50', feePercent: '1', feeCurrency: 'UAH' };
    expect(transferFee(swift, '3000', 'USD', toUah)).toMatchObject({ currency: 'UAH' });
    expect(transferFee(swift, '3000', 'USD', toUah)?.amount.toFixed(2)).toBe('1295.00');
    expect(transferFee({ feeFixed: null, feePercent: '0' }, '1', 'UAH')).toBeNull();
    // PrivatBank: 5 UAH a transfer, 15 UAH from 100 000 (A-084).
    const privat = { feeFixed: '5', feeStepFrom: '100000', feeStepFixed: '15' };
    expect(transferFee(privat, '93174.60', 'UAH')?.amount.toFixed(2)).toBe('5.00');
    expect(transferFee(privat, '101223', 'UAH')?.amount.toFixed(2)).toBe('15.00');
  });
});
