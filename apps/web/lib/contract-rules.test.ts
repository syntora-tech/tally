import { describe, expect, it } from 'vitest';
import { contractInput } from '@/server/services/clients/schema';
import { contractFormToInput, describeRule } from './contract-rules';

const base = {
  kind: 'client',
  number: 'MSA №20-08/25',
  clientId: '00000000-0000-4000-8000-000000000001',
  currency: 'usd',
};

describe('contractFormToInput', () => {
  it('maps defaults from spec 5.5 into valid rules', () => {
    const input = contractFormToInput({
      ...base,
      paymentDueType: 'day_of_month',
      paymentDueValue: '20',
      invoiceDateType: 'first_working_day_after_period',
      invoiceDateN: '',
      actDateType: 'last_working_day_of_period',
      actDateN: '',
    });
    const parsed = contractInput.parse(input);
    expect(parsed.paymentDueRule).toEqual({ type: 'day_of_month', day: 20 });
    expect(parsed.invoiceDateRule).toEqual({ type: 'first_working_day_after_period' });
    expect(parsed.actDateRule).toEqual({ type: 'last_working_day_of_period' });
    expect(parsed.currency).toBe('USD');
  });

  it('maps parametrized and manual rules', () => {
    const parsed = contractInput.parse(
      contractFormToInput({
        ...base,
        paymentDueType: 'net_days',
        paymentDueValue: '15',
        invoiceDateType: 'nth_working_day_after_period',
        invoiceDateN: '3',
        actDateType: 'manual',
        actDateN: '5',
      }),
    );
    expect(parsed.paymentDueRule).toEqual({ type: 'net_days', days: 15 });
    expect(parsed.invoiceDateRule).toEqual({ type: 'nth_working_day_after_period', n: 3 });
    expect(parsed.actDateRule).toEqual({ type: 'manual' });
  });

  it('rejects out-of-range parameters and wrong counterparties', () => {
    const bad = contractInput.safeParse(
      contractFormToInput({
        ...base,
        paymentDueType: 'day_of_month',
        paymentDueValue: '40',
        invoiceDateType: 'first_working_day_after_period',
        actDateType: 'manual',
      }),
    );
    expect(bad.success).toBe(false);
    const fop = contractInput.safeParse({ ...base, kind: 'fop' });
    expect(fop.success).toBe(false);
  });
});

describe('describeRule', () => {
  it.each([
    ['payment', { type: 'day_of_month', day: 20 }, 'до 20 числа'],
    ['payment', { type: 'net_days', days: 15 }, 'через 15 дн. після інвойсу'],
    ['invoice', { type: 'first_working_day_after_period' }, 'перший робочий день після періоду'],
    ['act', { type: 'nth_working_day_after_period', n: 3 }, '3-й робочий день після періоду'],
    ['act', { type: 'manual' }, 'вручну'],
  ] as const)('%s %j → %s', (kind, rule, text) => {
    expect(describeRule(kind, rule)).toBe(text);
  });
});
