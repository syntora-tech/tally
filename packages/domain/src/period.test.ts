import { describe, expect, it } from 'vitest';
import type { BillingTermsInput, PayTermsInput } from './billing';
import { parseLocalDate, type LocalDate } from './local-date';
import { draftLine, periodPreview, type PeriodAssignment } from './period';

const d = (s: string): LocalDate => parseLocalDate(s)._unsafeUnwrap();
const JAN = d('2026-01-01');

function a(
  name: string,
  client: string | null,
  hours: string | null,
  billing: BillingTermsInput | null,
  pay: PayTermsInput,
): PeriodAssignment {
  return {
    assignmentId: `${name}:${client ?? 'internal'}`,
    personName: name,
    clientName: client,
    contractId: client,
    roleTitle: null,
    isInternal: client === null,
    startsOn: JAN,
    endsOn: null,
    billing: billing ? [{ ...billing, validFrom: JAN, currency: 'USD' }] : [],
    pay: [{ ...pay, validFrom: JAN, currency: 'USD' }],
    hours,
  };
}

const none: BillingTermsInput = { type: 'none', rate: '0', prorationPolicy: 'full_month' };

// Spec 9.2: July 2026, H = 184, rate 44.48. Rows with h = 0 and hourly/included terms add 0.
const july: PeriodAssignment[] = [
  a('Dolina', null, null, none, { type: 'fixed', amount: '2020' }),
  a('Vladyslav', null, null, none, { type: 'fixed', amount: '2020' }),
  a(
    'Vladyslav',
    'Trady',
    '184',
    { type: 'fixed_monthly', rate: '5500', prorationPolicy: 'full_month' },
    { type: 'hourly', amount: '5000' },
  ),
  a('Anton', null, null, none, { type: 'fixed', amount: '1150' }),
  a(
    'Andrii',
    'IdeaSoft',
    '184',
    { type: 'hourly', rate: '47', prorationPolicy: 'full_month' },
    { type: 'hourly', amount: '3000' },
  ),
  a('Wita', null, null, none, { type: 'fixed', amount: '2300' }),
  a(
    'Sklyarov',
    'Boosty',
    '5',
    { type: 'hourly', rate: '45', prorationPolicy: 'full_month' },
    { type: 'hourly', amount: '7360' },
  ),
  a(
    'Wita',
    'Boosty',
    '0',
    { type: 'fixed_monthly', rate: '4200', prorationPolicy: 'by_hours' },
    { type: 'included', amount: '0' },
  ),
];

describe('periodPreview — spec 9.2 etalon, July 2026', () => {
  const preview = periodPreview(d('2026-07-01'), '184', '44.48', july);

  it('invoice total 14 373.00 includes the Sklyarov row the sheet lost (A1)', () => {
    expect(preview.totals.invoiceUsd).toBe('14373.00');
  });

  it('payroll total 15 690.00 USD', () => {
    expect(preview.totals.payUsd).toBe('15690.00');
  });

  it('row amounts match the etalon table', () => {
    const byName = Object.fromEntries(
      preview.rows.map((r) => [`${r.personName}:${r.clientName ?? '-'}`, r]),
    );
    expect(byName['Vladyslav:Trady']).toMatchObject({
      invoiceAmount: '5500.00',
      payUsd: '5000.00',
      payUahApprox: '222400.00',
    });
    expect(byName['Andrii:IdeaSoft']).toMatchObject({
      invoiceAmount: '8648.00',
      payUsd: '3000.00',
      payUahApprox: '133440.00',
    });
    expect(byName['Sklyarov:Boosty']).toMatchObject({
      invoiceAmount: '225.00',
      payUsd: '200.00',
      payUahApprox: '8896.00',
    });
    expect(byName['Anton:-']).toMatchObject({ payUsd: '1150.00', payUahApprox: '51152.00' });
    expect(byName['Wita:Boosty']?.invoiceAmount).toBeNull();
  });

  it('UAH before adjustments: 701 216.20 − 3 325 (CTO adjustment arrives in stage 3)', () => {
    expect(preview.totals.payUahApprox).toBe('697891.20');
  });

  it('skips assignments not active in the month', () => {
    const ended = { ...july[2], assignmentId: 'old', endsOn: d('2026-06-30') } as PeriodAssignment;
    expect(periodPreview(d('2026-07-01'), '184', null, [ended]).rows).toHaveLength(0);
  });
});

describe('draftLine (invoice line layout, spec 5.1)', () => {
  it('full_month: quantity 1, unit price = monthly fee', () => {
    expect(
      draftLine(
        'x',
        { type: 'fixed_monthly', rate: '5500', prorationPolicy: 'full_month' },
        '184',
        '184',
      ),
    ).toEqual({
      assignmentId: 'x',
      quantity: '1.00',
      unitPrice: '5500.00000000',
      amount: '5500.00',
    });
  });

  it('hourly: hours × rate', () => {
    expect(
      draftLine('x', { type: 'hourly', rate: '47', prorationPolicy: 'full_month' }, '184', '184'),
    ).toMatchObject({
      quantity: '184.00',
      unitPrice: '47.00000000',
      amount: '8648.00',
    });
  });

  it('by_hours: effective hourly rate r / H', () => {
    expect(
      draftLine(
        'x',
        { type: 'fixed_monthly', rate: '5500', prorationPolicy: 'by_hours' },
        '32',
        '160',
      ),
    ).toMatchObject({
      quantity: '32.00',
      unitPrice: '34.37500000',
      amount: '1100.00',
    });
  });

  it('trunc_hourly: floor(r / H)', () => {
    expect(
      draftLine(
        'x',
        { type: 'fixed_monthly', rate: '5000', prorationPolicy: 'trunc_hourly' },
        '10',
        '184',
      ),
    ).toMatchObject({
      unitPrice: '27.00000000',
      amount: '270.00',
    });
  });

  it('no line for zero hours or billing none', () => {
    expect(
      draftLine('x', { type: 'hourly', rate: '47', prorationPolicy: 'full_month' }, '0', '184'),
    ).toBeNull();
    expect(draftLine('x', none, '184', '184')).toBeNull();
  });
});
