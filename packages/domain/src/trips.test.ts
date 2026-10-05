import { describe, expect, it } from 'vitest';
import { parseLocalDate, type LocalDate } from './local-date';
import { receiptKey, tripExpenseAmounts, tripStatus, tripSummary } from './trips';

const d = (s: string): LocalDate => parseLocalDate(s)._unsafeUnwrap();

describe('tripExpenseAmounts (6.8)', () => {
  it('converts EUR to UAH at its rate and to USD through the USD rate', () => {
    expect(tripExpenseAmounts('10.98', 'EUR', '51.8', '41.5')).toEqual({
      amountUah: '568.76',
      amountUsd: '13.70506024',
    });
  });

  it('keeps dollars and stablecoins as they are', () => {
    expect(tripExpenseAmounts('251', 'USDT', '41.5', '41.5').amountUsd).toBe('251.00000000');
  });
});

describe('tripSummary (6.8)', () => {
  const expenses = [
    {
      personId: 'a',
      amountUah: '30384.79',
      amountUsd: '682.54',
      reimbursable: true,
      paidBy: 'person' as const,
    },
    {
      personId: 'a',
      amountUah: '3500',
      amountUsd: '80',
      reimbursable: false,
      paidBy: 'company' as const,
    },
    {
      personId: 'b',
      amountUah: '1000',
      amountUsd: '24',
      reimbursable: true,
      paidBy: 'person' as const,
    },
  ];

  it('Munich: everything reimbursed by act А8 leaves nothing', () => {
    const [a, b] = tripSummary(['a', 'b'], expenses, [{ personId: 'a', paidUah: '30384.79' }]);
    expect(a).toMatchObject({
      spentUah: '33884.79',
      toReimburseUah: '30384.79',
      reimbursedUah: '30384.79',
      remainingUah: '0.00',
    });
    expect(b).toMatchObject({ remainingUah: '1000.00', remainingUsd: '24.00' });
  });
});

describe('tripStatus (A-070)', () => {
  const trip = { startsOn: d('2026-06-15'), endsOn: d('2026-06-21') };
  it('follows the dates, then the money', () => {
    expect(tripStatus(trip, '0', d('2026-06-01'))).toBe('planned');
    expect(tripStatus(trip, '100', d('2026-06-21'))).toBe('in_progress');
    expect(tripStatus(trip, '100', d('2026-06-22'))).toBe('awaiting_reimbursement');
    expect(tripStatus(trip, '0', d('2026-06-22'))).toBe('settled');
    expect(tripStatus({ startsOn: null, endsOn: null }, '0', d('2026-06-01'))).toBe('settled');
  });
});

describe('receiptKey (6.8 AC)', () => {
  it('ignores case and spacing of the description', () => {
    expect(
      receiptKey({
        spentOn: '2026-06-21',
        amount: '10.98',
        currency: 'EUR',
        description: ' Uber ',
      }),
    ).toBe(
      receiptKey({ spentOn: '2026-06-21', amount: '10.980', currency: 'EUR', description: 'uber' }),
    );
  });
});
