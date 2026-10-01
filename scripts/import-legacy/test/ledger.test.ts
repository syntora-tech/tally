import { describe, expect, it } from 'vitest';
import { excelDate, parseLedger } from '../src/sources/ledger';
import { ledgerBook } from './fixtures';

describe('Ledger import (spec 8.1, 8.3)', () => {
  const ledger = parseLedger(ledgerBook());

  it('reads Excel serial dates', () => {
    expect(excelDate(46023)).toBe('2026-01-01');
    expect(excelDate('x')).toBeNull();
  });

  it('turns rows into postings with fees as separate negative postings', () => {
    expect(ledger.transactions).toHaveLength(3);
    expect(ledger.transactions[0]).toMatchObject({
      type: 'revenue',
      occurredOn: '2026-01-01',
      postings: [
        { account: 'Privat USD', amount: '2000', isFee: false },
        { account: 'Privat USD', amount: '-5', isFee: true },
      ],
    });
  });

  it('books in the account currency (A10) and rounds fiat formula tails to cents (A11)', () => {
    expect(ledger.transactions[1]?.postings).toEqual([
      { account: 'Crypto ETH - USDC', amount: '-100', isFee: false },
    ]);
    expect(ledger.transactions[2]?.postings[1]).toEqual({
      account: 'Privat EUR',
      amount: '1198.8',
      isFee: false,
    });
    expect(ledger.anomalies.map((a) => a.code).sort()).toEqual([
      'ledger_amount_rounded',
      'ledger_currency_mismatch',
    ]);
  });

  it('keeps USD→UAH and EUR→USD rates and reconciles balances within 0.01', () => {
    expect(ledger.rates).toEqual([
      { onDate: '2026-02-04', base: 'EUR', quote: 'USD', rate: '1.168' },
      { onDate: '2026-02-04', base: 'USD', quote: 'UAH', rate: '43' },
    ]);
    const byAccount = Object.fromEntries(ledger.reconciliation.map((r) => [r.account, r]));
    expect(byAccount['Privat USD']).toMatchObject({ computed: '4496.58', ok: true });
    expect(byAccount['Crypto ETH - USDC']).toMatchObject({ computed: '859.922092', ok: true });
    // The sheet's 0.00137 EUR tail (A11) is what the rounding removes: 1198.80 vs 1198.80137.
    expect(byAccount['Privat EUR']?.ok).toBe(true);
  });
});
