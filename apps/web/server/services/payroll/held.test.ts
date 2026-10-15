import { describe, expect, it } from 'vitest';
import { payrollGroup } from './held';

// Vladyslav's September: the CTO act paid, the BoostyLabs work held for the client.
const lines = [
  { status: 'payable', amount: '804', currency: 'USD' },
  { status: 'awaiting_client', amount: '4000', currency: 'USD' },
];
const item = (status: string, paidAmount: string) => ({
  status,
  paidAmount,
  payoutMethod: 'fiat',
  payoutFxRate: '44.73',
});

describe('payrollGroup', () => {
  it('a payout whose released part and adjustments are paid waits for the client', () => {
    expect(payrollGroup(item('partially_paid', '38594.70'), '217514.70', lines)).toBe('waiting');
  });

  it('a part still payable keeps it ready', () => {
    expect(payrollGroup(item('partially_paid', '30000'), '217514.70', lines)).toBe('ready');
    expect(payrollGroup(item('partially_payable', '0'), '217514.70', lines)).toBe('ready');
  });

  it('paid and draft payouts keep their groups', () => {
    expect(payrollGroup(item('paid', '217514.70'), '217514.70', lines)).toBe('paid');
    expect(payrollGroup(item('draft', '0'), '217514.70', lines)).toBe('waiting');
  });
});
