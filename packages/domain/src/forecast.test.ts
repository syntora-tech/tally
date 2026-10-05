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
        frequency: 'monthly',
        anchorMonth: null,
        dueDay: 10,
        startsOn: d('2026-01-01'),
        endsOn: null,
        amount: '12000',
        currency: 'UAH',
      },
      {
        frequency: 'yearly',
        anchorMonth: 12,
        dueDay: 1,
        startsOn: d('2026-01-01'),
        endsOn: null,
        amount: '40',
        currency: 'USD',
      },
      {
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
