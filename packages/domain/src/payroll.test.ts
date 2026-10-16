import { describe, expect, it } from 'vitest';
import { WorkCalendar } from './calendar';
import { parseLocalDate, type LocalDate } from './local-date';
import { roundHalfUp, sum, toDecimal } from './money';
import {
  linePaidAmounts,
  nextPartPeriod,
  payoutPartOf,
  payoutRest,
  payoutRestUah,
  rateForUah,
  derivedRate,
  payrollItemStatus,
  payrollTotalUah,
  payrollTotalUsd,
  resolvePayability,
  resolvePayee,
  suggestPayoutRate,
} from './payroll';

const d = (s: string): LocalDate => parseLocalDate(s)._unsafeUnwrap();
const cal = new WorkCalendar([]);
const usd = (amounts: string[]) => amounts.map((amount) => ({ amount, currency: 'USD' }));
const uah = (lines: string[], adj: { amount: string; currency: string }[] = [], fx = '44.48') =>
  payrollTotalUah(usd(lines), adj, fx)._unsafeUnwrap().toFixed(2);

describe('payroll item totals (spec 5.2, 9.2)', () => {
  it('CTO: 2 020 × 44.48 + 3 325 UAH adjustment = 93 174.60 (act 1002 - А8)', () => {
    expect(uah(['2020'], [{ amount: '3325', currency: 'UAH' }])).toBe('93174.60');
  });

  it('USD adjustments are converted with the lines, stablecoins count as USD', () => {
    expect(uah(['1000'], [{ amount: '-100', currency: 'USD' }], '40')).toBe('36000.00');
    expect(payrollTotalUsd(usd(['1000']), [{ amount: '20', currency: 'USDT' }]).toFixed(2)).toBe(
      '1020.00',
    );
  });

  it('UAH lines are added as they are; a rate is needed only for a USD part (A-075)', () => {
    const lines = [
      { amount: '1000', currency: 'USD' },
      { amount: '20000', currency: 'UAH' },
    ];
    expect(payrollTotalUah(lines, [], '41.5')._unsafeUnwrap().toFixed(2)).toBe('61500.00');
    expect(payrollTotalUsd(lines, []).toFixed(2)).toBe('1000.00');
    expect(payrollTotalUah(lines, [], null)._unsafeUnwrapErr()).toEqual({ code: 'rate_required' });
    expect(
      payrollTotalUah(
        [{ amount: '20000', currency: 'UAH' }],
        [{ amount: '500', currency: 'UAH' }],
        null,
      )
        ._unsafeUnwrap()
        .toFixed(2),
    ).toBe('20500.00');
  });

  it('rejects adjustments in other currencies', () => {
    expect(
      payrollTotalUah(usd(['1']), [{ amount: '1', currency: 'EUR' }], '44')._unsafeUnwrapErr(),
    ).toEqual({
      code: 'unsupported_currency',
      currency: 'EUR',
    });
  });

  it('9.2 etalon: payroll UAH total 701 216.20 with one item per person × payee', () => {
    const items = [
      { lines: ['2020'], adj: [] }, // Dolina, CEO
      { lines: ['2020'], adj: [{ amount: '3325', currency: 'UAH' }] }, // Vladyslav, CTO (FOP)
      { lines: ['5000'], adj: [] }, // Vladyslav × Trady (crypto)
      { lines: ['1150'], adj: [] }, // Anton
      { lines: ['3000'], adj: [] }, // Andrii × IdeaSoft
      { lines: ['2300', '0'], adj: [] }, // Wita, incl. the zero `included` Boosty line
      { lines: ['200'], adj: [] }, // Sklyarov × Boosty
    ];
    const rows = items.map((i) => uah(i.lines, i.adj));
    expect(rows).toEqual([
      '89849.60',
      '93174.60',
      '222400.00',
      '51152.00',
      '133440.00',
      '102304.00',
      '8896.00',
    ]);
    expect(sum(rows).toFixed(2)).toBe('701216.20');
    expect(sum(items.flatMap((i) => i.lines)).toFixed(2)).toBe('15690.00');
  });
});

describe('resolvePayee (5.2)', () => {
  const payees = [
    { id: 'fop', kind: 'fop' as const },
    { id: 'wallet', kind: 'crypto' as const },
  ];
  it('fiat goes to the default payee, crypto to the wallet', () => {
    expect(resolvePayee('fiat', 'fop', payees)).toBe('fop');
    expect(resolvePayee('crypto', 'fop', payees)).toBe('wallet');
    expect(resolvePayee('crypto', null, [payees[0] ?? { id: '', kind: 'fop' }])).toBeNull();
  });
});

describe('resolvePayability (5.3)', () => {
  const terms = { releasePolicy: 'on_payment_or_due' as const, graceDays: 0 };
  const invoice = { total: '8648', paidAmount: '0', dueDate: d('2026-09-20') };

  it('internal work and immediate release are payable at company expense', () => {
    expect(resolvePayability(null, terms, d('2026-09-01'), cal)).toEqual({
      payable: true,
      funding: 'company',
    });
    expect(
      resolvePayability(invoice, { ...terms, releasePolicy: 'immediate' }, d('2026-09-01'), cal),
    ).toEqual({ payable: true, funding: 'company' });
  });

  it('full payment before the deadline releases it as client-funded', () => {
    expect(
      resolvePayability({ ...invoice, paidAmount: '8648' }, terms, d('2026-09-17'), cal),
    ).toEqual({ payable: true, funding: 'client' });
  });

  it('partial payment waits; due on Sunday 20.09 → deadline Monday 21.09', () => {
    const half = { ...invoice, paidAmount: '4324' };
    expect(resolvePayability(half, terms, d('2026-09-18'), cal)).toEqual({
      payable: false,
      deadline: '2026-09-21',
    });
    expect(resolvePayability(half, terms, d('2026-09-21'), cal)).toEqual({
      payable: true,
      funding: 'company',
    });
  });

  it('grace days are working days after the deadline', () => {
    expect(resolvePayability(invoice, { ...terms, graceDays: 2 }, d('2026-09-22'), cal)).toEqual({
      payable: false,
      deadline: '2026-09-23',
    });
  });
});

describe('payrollItemStatus (5.3 rule 6)', () => {
  it('derives the item status from lines and payments', () => {
    expect(payrollItemStatus(['awaiting_client', 'payable'], '0', '100')).toBe('partially_payable');
    expect(payrollItemStatus(['payable', 'payable'], '0', '100')).toBe('payable');
    expect(payrollItemStatus(['accrued'], '0', '100')).toBe('draft');
    expect(payrollItemStatus(['payable'], '40', '100')).toBe('partially_paid');
    expect(payrollItemStatus(['paid'], '100', '100')).toBe('paid');
  });
});

describe('FX (5.4, 9.1)', () => {
  it('derives the rate from two actual amounts', () => {
    expect(derivedRate('2000', '86100').toFixed(6)).toBe('43.050000');
    expect(derivedRate('-1400.2', '1198.8').toFixed(6)).toBe('0.856163');
  });

  it('cascades bank_actual (≤ 3 days) → nbu → manual', () => {
    const nbu = { onDate: d('2026-09-21'), rate: '41.2' };
    const lastManual = { onDate: d('2026-08-01'), rate: '41' };
    const exchanges = [
      { occurredOn: d('2026-09-15'), usd: '-1000', uah: '41000' },
      { occurredOn: d('2026-09-19'), usd: '-2000', uah: '82600' },
    ];
    expect(suggestPayoutRate(d('2026-09-21'), { exchanges, nbu, lastManual })).toMatchObject({
      source: 'bank_actual',
      onDate: '2026-09-19',
    });
    expect(suggestPayoutRate(d('2026-09-23'), { exchanges, nbu, lastManual })?.source).toBe('nbu');
    expect(suggestPayoutRate(d('2026-09-23'), { exchanges, nbu: null, lastManual })?.source).toBe(
      'manual',
    );
    expect(
      suggestPayoutRate(d('2026-09-23'), { exchanges: [], nbu: null, lastManual: null }),
    ).toBeNull();
  });
});

describe('payout parts (A-083)', () => {
  const lines = [{ amount: '5000', currency: 'USD' }];
  const adjustments = [{ amount: '3325', currency: 'UAH' }];

  it('takes USD first at the payment rate and leaves the rest for the next rate', () => {
    const rest = payoutRest(lines, adjustments, []);
    const part = payoutPartOf(rest, '41500', '41.5');
    expect(part).toMatchObject({ coversRest: false });
    expect(part.usd.toFixed(2)).toBe('1000.00');
    const after = payoutRest(lines, adjustments, [{ usd: part.usd, uah: part.uah, rate: '41.5' }]);
    expect(after.usd.toFixed(2)).toBe('4000.00');
    expect(after.uah.toFixed(2)).toBe('3325.00');
    // 4 000 × 42 + 3 325 at the later rate.
    expect(payoutRestUah(after, '42')?.toFixed(2)).toBe('171325.00');
    const last = payoutPartOf(after, '171325', '42');
    expect(last).toMatchObject({ coversRest: true });
    const done = payoutRest(lines, adjustments, [
      { usd: part.usd, uah: part.uah, rate: '41.5' },
      { usd: last.usd, uah: last.uah, rate: '42' },
    ]);
    expect([done.usd.toFixed(2), done.uah.toFixed(2)]).toEqual(['0.00', '0.00']);
  });

  it('dates a part from the first uncovered day to the payout day in the month of work', () => {
    const m = d('2026-09-01');
    expect(nextPartPeriod(m, [], d('2026-10-16'), false)).toEqual({
      from: '2026-09-01',
      to: '2026-09-16',
    });
    expect(
      nextPartPeriod(m, [{ from: d('2026-09-01'), to: d('2026-09-16') }], d('2026-10-31'), true),
    ).toEqual({ from: '2026-09-17', to: '2026-09-30' });
    expect(
      nextPartPeriod(m, [{ from: d('2026-09-01'), to: d('2026-09-30') }], d('2026-10-31'), true),
    ).toBeNull();
    expect(
      nextPartPeriod(m, [{ from: d('2026-09-01'), to: d('2026-09-20') }], d('2026-10-05'), false),
    ).toEqual({
      from: '2026-09-21',
      to: '2026-09-21',
    });
  });
});

describe('rateForUah', () => {
  it('finds a 6-place rate that gives exactly the typed UAH sum', () => {
    const rate = rateForUah('704', '31649.52');
    expect(rate?.toFixed(6)).toBe('44.956705');
    expect(roundHalfUp(toDecimal('704').times(rate ?? 0)).toFixed(2)).toBe('31649.52');
  });

  it('hits every cent for sums up to 10 000 USD', () => {
    for (const [usd, uah] of [
      ['1', '41.37'],
      ['3', '100.01'],
      ['9999.99', '415000.00'],
      ['2020', '89849.60'],
    ] as const) {
      const rate = rateForUah(usd, uah);
      expect(rate).not.toBeNull();
      expect(roundHalfUp(toDecimal(usd).times(rate ?? 0)).toFixed(2)).toBe(uah);
    }
  });

  it('gives up on nonsense', () => {
    expect(rateForUah('0', '100')).toBeNull();
    expect(rateForUah('100', '0')).toBeNull();
  });
});

describe('linePaidAmounts (A-110)', () => {
  const lines = [
    { id: 'cto', amount: '804', currency: 'USD', status: 'payable' },
    { id: 'client', amount: '4000', currency: 'USD', status: 'payable' },
    { id: 'other', amount: '2644', currency: 'UAH', status: 'payable' },
  ];
  const adjustments = [
    { amount: '-0.27', currency: 'USD' },
    { amount: '-0.14', currency: 'UAH' },
  ];
  const paidOf = (parts: Parameters<typeof linePaidAmounts>[2]) =>
    Object.fromEntries(
      [...linePaidAmounts(lines, adjustments, parts)].map(([id, v]) => [id, v.toFixed(2)]),
    );

  it('pays nothing without a paid part, corrections included', () => {
    expect(paidOf([])).toEqual({ cto: '0.00', client: '0.00', other: '0.00' });
  });

  it('a part split off by amount covers the corrections, then the lines in order', () => {
    // 803.73 $ × 44.73 = 35 950.84 + 2 643.86 of the UAH part = 38 594.70.
    expect(paidOf([{ usd: '803.73', uah: '38594.70', rate: '44.73' }])).toEqual({
      cto: '804.00',
      client: '0.00',
      other: '2644.00',
    });
  });

  it('leaves the line the money ran out on partly paid', () => {
    expect(paidOf([{ usd: '1803.73', uah: '83324.70', rate: '44.73' }])).toMatchObject({
      cto: '804.00',
      client: '1000.00',
    });
  });

  it('released lines take the money before the held ones', () => {
    const held = [
      { id: 'held', amount: '500', currency: 'USD', status: 'awaiting_client' },
      { id: 'ready', amount: '500', currency: 'USD', status: 'payable' },
    ];
    const paid = linePaidAmounts(held, [], [{ usd: '500', uah: '0', rate: null }]);
    expect(paid.get('ready')?.toFixed(2)).toBe('500.00');
    expect(paid.get('held')?.toFixed(2)).toBe('0.00');
  });
});
