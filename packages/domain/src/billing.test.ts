import { describe, expect, it } from 'vitest';
import { billingLineAmount, marginByTerms, payrollLineAmount } from './billing';
import { sum } from './money';

const H = '184'; // July 2026 norm hours (spec 9.2)

describe('billingLineAmount (spec 5.1)', () => {
  it('hourly: r × h — IdeaSoft 47 × 184', () => {
    expect(
      billingLineAmount(
        { type: 'hourly', rate: '47', prorationPolicy: 'full_month' },
        '184',
        H,
      )?.toFixed(2),
    ).toBe('8648.00');
  });

  it('fixed_monthly + full_month: r regardless of hours — Trady', () => {
    const terms = { type: 'fixed_monthly', rate: '5500', prorationPolicy: 'full_month' } as const;
    expect(billingLineAmount(terms, '184', H)?.toFixed(2)).toBe('5500.00');
    expect(billingLineAmount(terms, '40', H)?.toFixed(2)).toBe('5500.00');
  });

  it('fixed_monthly + by_hours: r / H × h — Boosty SOW', () => {
    const terms = { type: 'fixed_monthly', rate: '5500', prorationPolicy: 'by_hours' } as const;
    expect(billingLineAmount(terms, '92', H)?.toFixed(2)).toBe('2750.00');
    expect(billingLineAmount(terms, '100', H)?.toFixed(2)).toBe('2989.13');
  });

  it('fixed_monthly + trunc_hourly: floor(r / H) × h — Pavlo, floor(5000 / 184) = 27', () => {
    const terms = { type: 'fixed_monthly', rate: '5000', prorationPolicy: 'trunc_hourly' } as const;
    expect(billingLineAmount(terms, '10', H)?.toFixed(2)).toBe('270.00');
  });

  it('creates no line for zero hours or billing type none', () => {
    expect(
      billingLineAmount({ type: 'hourly', rate: '47', prorationPolicy: 'full_month' }, '0', H),
    ).toBeNull();
    expect(
      billingLineAmount({ type: 'none', rate: '0', prorationPolicy: 'full_month' }, '184', H),
    ).toBeNull();
  });

  it('rounds line amounts half-up to 2 decimals', () => {
    expect(
      billingLineAmount(
        { type: 'hourly', rate: '10.005', prorationPolicy: 'full_month' },
        '1',
        H,
      )?.toFixed(2),
    ).toBe('10.01');
  });
});

describe('payrollLineAmount (spec 5.2)', () => {
  it('fixed: amount as is, FTE already applied — Anton 2300 × 0.5', () => {
    expect(payrollLineAmount({ type: 'fixed', amount: '1150' }, '0', H).toFixed(2)).toBe('1150.00');
  });

  it('hourly: amount / H × h — Sklyarov 7360 / 184 × 5', () => {
    expect(payrollLineAmount({ type: 'hourly', amount: '7360' }, '5', H).toFixed(2)).toBe('200.00');
  });

  it('included: zero', () => {
    expect(payrollLineAmount({ type: 'included', amount: '999' }, '184', H).toFixed(2)).toBe(
      '0.00',
    );
  });

  it('reproduces the July 2026 payroll USD total of 15 690.00 (spec 9.2)', () => {
    const lines = [
      payrollLineAmount({ type: 'fixed', amount: '2020' }, '0', H),
      payrollLineAmount({ type: 'fixed', amount: '2020' }, '0', H),
      payrollLineAmount({ type: 'fixed', amount: '5000' }, '184', H),
      payrollLineAmount({ type: 'fixed', amount: '1150' }, '0', H),
      payrollLineAmount({ type: 'fixed', amount: '3000' }, '184', H),
      payrollLineAmount({ type: 'fixed', amount: '2300' }, '0', H),
      payrollLineAmount({ type: 'hourly', amount: '7360' }, '5', H),
    ];
    expect(sum(lines).toFixed(2)).toBe('15690.00');
  });
});

describe('marginByTerms (assumptions A-015)', () => {
  it('fixed billing vs fixed pay — Trady 5 500 − 5 000', () => {
    const m = marginByTerms(
      { type: 'fixed_monthly', rate: '5500', prorationPolicy: 'full_month', currency: 'USD' },
      { type: 'fixed', amount: '5000', currency: 'USD' },
      H,
    );
    expect(m?.margin.toFixed(2)).toBe('500.00');
  });

  it('hourly billing uses h = H — IdeaSoft 8 648 − 3 000', () => {
    const m = marginByTerms(
      { type: 'hourly', rate: '47', prorationPolicy: 'full_month', currency: 'USD' },
      { type: 'fixed', amount: '3000', currency: 'USD' },
      H,
    );
    expect(m?.billing.toFixed(2)).toBe('8648.00');
    expect(m?.margin.toFixed(2)).toBe('5648.00');
  });

  it('internal assignment without billing has negative margin', () => {
    const m = marginByTerms(null, { type: 'fixed', amount: '2020', currency: 'USD' }, H);
    expect(m?.margin.toFixed(2)).toBe('-2020.00');
  });

  it('is not computed across currencies', () => {
    expect(
      marginByTerms(
        { type: 'hourly', rate: '47', prorationPolicy: 'full_month', currency: 'EUR' },
        { type: 'fixed', amount: '3000', currency: 'USD' },
        H,
      ),
    ).toBeNull();
  });
});
