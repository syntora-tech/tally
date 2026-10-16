import { describe, expect, it } from 'vitest';
import { withLinePayments } from './paid-lines';

const fiat = { status: 'partially_paid', payoutMethod: 'fiat', paidAmount: '38594.70' };
const line = (
  id: string,
  amount: string,
  currency = 'USD',
  supplierActId: string | null = null,
) => ({
  id,
  amount,
  currency,
  status: 'payable',
  supplierActId,
});
const act = (id: string, amountUsd: string | null, amountUah: string, rateLocked: boolean) => ({
  id,
  amountUsd,
  amountUah,
  fxRate: '44.73',
  rateLocked,
});
const statusOf = (rows: { id: string; status: string; paidAmount: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.id, `${r.status} ${r.paidAmount}`]));

describe('withLinePayments (A-110)', () => {
  it('a paid part split off by amount marks the lines it covers as paid', () => {
    const rows = withLinePayments(
      fiat,
      [line('cto', '804'), line('client', '4000'), line('other', '2644', 'UAH')],
      [
        { amount: '-0.27', currency: 'USD', supplierActId: null },
        { amount: '-0.14', currency: 'UAH', supplierActId: null },
      ],
      [act('part', '803.73', '38594.70', true), act('rest', null, '178920.00', false)],
    );
    expect(statusOf(rows)).toEqual({
      cto: 'paid 804.00',
      client: 'payable 0.00',
      other: 'paid 2644.00',
    });
  });

  it('a line of its own act is paid with that act, and only then', () => {
    const rows = withLinePayments(
      { ...fiat, paidAmount: '35761.64' },
      [line('cto', '804', 'USD', 'own'), line('client', '4000', 'USD', 'next')],
      [],
      [
        act('own', '804', '35962.92', true),
        act('next', '4000', '178920.00', false),
        act('rest', null, '0', false),
      ],
    );
    expect(statusOf(rows)).toEqual({ cto: 'paid 804.00', client: 'payable 0.00' });
  });

  it('a paid payout has every line paid', () => {
    const rows = withLinePayments(
      { status: 'paid', payoutMethod: 'crypto', paidAmount: '4804' },
      [line('cto', '804'), line('client', '4000')],
      [],
      [],
    );
    expect(statusOf(rows)).toEqual({ cto: 'paid 804.00', client: 'paid 4000.00' });
  });

  it('a crypto payout paid in part covers its lines in order', () => {
    const rows = withLinePayments(
      { status: 'partially_paid', payoutMethod: 'crypto', paidAmount: '1000' },
      [line('cto', '804'), line('client', '4000')],
      [],
      [],
    );
    expect(statusOf(rows)).toEqual({ cto: 'paid 804.00', client: 'payable 196.00' });
  });
});
