import { describe, expect, it } from 'vitest';
import { forecastMonths, type ForecastAssignment } from './forecast';
import { parseLocalDate, type LocalDate } from './local-date';
import { usdConverter } from './usd';

const d = (s: string): LocalDate => parseLocalDate(s)._unsafeUnwrap();
const toUsd = usdConverter([{ onDate: d('2026-10-01'), base: 'USD', quote: 'UAH', rate: '40' }]);

const andrii: ForecastAssignment = {
  assignmentId: 'andrii',
  fte: '1',
  startsOn: d('2026-01-01'),
  endsOn: null,
  billing: [
    {
      validFrom: d('2026-01-01'),
      type: 'hourly',
      rate: '47',
      prorationPolicy: 'full_month',
      currency: 'USD',
    },
  ],
  pay: [{ validFrom: d('2026-01-01'), type: 'hourly', amount: '3000', currency: 'USD' }],
  agency: [{ validFrom: d('2026-01-01'), ratePerHour: '4' }],
};
const halfTime: ForecastAssignment = {
  assignmentId: 'half',
  fte: '0.5',
  startsOn: d('2026-01-01'),
  endsOn: d('2026-11-15'),
  billing: [
    {
      validFrom: d('2026-01-01'),
      type: 'fixed_monthly',
      rate: '2750',
      prorationPolicy: 'full_month',
      currency: 'USD',
    },
  ],
  pay: [{ validFrom: d('2026-01-01'), type: 'fixed', amount: '1150', currency: 'USD' }],
  agency: [],
};

describe('forecastMonths (6.1, A-069)', () => {
  const months = [
    { month: d('2026-11-01'), workHours: '168' },
    { month: d('2026-12-01'), workHours: '184' },
  ];
  const result = forecastMonths(
    months,
    [andrii, halfTime],
    [
      {
        name: 'Accountant',
        frequency: 'monthly',
        anchorMonth: null,
        dueDay: 10,
        startsOn: d('2026-01-01'),
        endsOn: null,
        amount: '12000',
        currency: 'UAH',
      },
      {
        name: 'Domain',
        frequency: 'yearly',
        anchorMonth: 12,
        dueDay: 1,
        startsOn: d('2026-01-01'),
        endsOn: null,
        amount: '40',
        currency: 'USD',
      },
      {
        name: 'Pounds',
        frequency: 'monthly',
        anchorMonth: null,
        dueDay: 1,
        startsOn: d('2026-01-01'),
        endsOn: null,
        amount: '10',
        currency: 'GBP',
      },
    ],
    toUsd,
  );

  it('counts every active assignment at H × FTE with its agency fee', () => {
    // November: 47 × 168 + 2750; pay 3000 + 1150; agency 4 × 168; planned 12000 UAH / 40.
    expect(result[0]).toMatchObject({
      revenueUsd: '10646.00',
      payrollUsd: '4150.00',
      agencyUsd: '672.00',
      plannedUsd: '300.00',
      netUsd: '5524.00',
    });
  });

  it('drops ended assignments, adds yearly costs in their month, flags missing rates', () => {
    expect(result[1]).toMatchObject({
      revenueUsd: '8648.00',
      payrollUsd: '3000.00',
      agencyUsd: '736.00',
      plannedUsd: '340.00',
      unconverted: ['GBP'],
    });
  });
});

describe('forecastMonths with charges and fees (A-082)', () => {
  const month = [{ month: d('2026-11-01'), workHours: '168' }];
  const tax = {
    id: 'tax',
    name: 'Tax 20 %',
    mode: 'on_top' as const,
    ratePercent: '20',
    currency: 'UAH',
    startsOn: d('2026-01-01'),
    endsOn: null,
    feeFixed: '5',
  };

  it('adds payout taxes and the payee fee of a person', () => {
    const [m] = forecastMonths(month, [{ ...andrii, personId: 'p1' }], [], toUsd, [
      { personId: 'p1', charges: [tax], fee: { feeFixed: '400', feeCurrency: 'UAH' } },
    ]);
    // 20 % of 3000 USD = 600; 5 UAH + 400 UAH at 40 = 10.125.
    expect(m?.chargesUsd).toBe('610.13');
    expect(m?.netUsd).toBe('3613.88');
  });

  it('counts parts, on-top charges and fees of a planned expense', () => {
    const [m] = forecastMonths(
      month,
      [],
      [
        {
          name: 'Salary',
          frequency: 'monthly',
          anchorMonth: null,
          dueDay: 1,
          startsOn: d('2026-01-01'),
          endsOn: null,
          amount: '10000',
          currency: 'UAH',
          parts: [
            { id: 'a', name: 'Advance', amount: '5000', dueDay: 22, monthOffset: 0 },
            { id: 'r', name: 'Rest', amount: null, dueDay: 7, monthOffset: 1 },
          ],
          charges: [
            {
              ...tax,
              id: 'pit',
              mode: 'withheld',
              ratePercent: '18',
              currency: null,
              feeFixed: null,
            },
            { ...tax, id: 'esv', ratePercent: '22', currency: null, feeFixed: '20' },
          ],
        },
      ],
      toUsd,
    );
    // 10 000 gross + 2 200 on top + 2 × 20 fee = 12 240 UAH.
    expect(m?.plannedUsd).toBe('306.00');
  });
});
