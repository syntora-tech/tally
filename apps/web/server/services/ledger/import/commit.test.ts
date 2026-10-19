import { describe, expect, it } from 'vitest';
import { planCommit } from './commit';
import type { Decision, ImportRow } from './rows';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const GAS = '00000000-0000-4000-8000-00000000000c';
const CAT = '00000000-0000-4000-8000-0000000000c1';

const row = (key: string, patch: Partial<ImportRow> = {}): ImportRow => ({
  key,
  accountId: A,
  occurredOn: '2045-06-02',
  direction: 'out',
  amount: '100',
  currency: 'USD',
  externalRef: `privat:${key}`,
  ref: key,
  docNumber: null,
  purpose: `purpose ${key}`,
  counterparty: null,
  counterpartyTaxId: null,
  counterpartyAccount: null,
  ourAccount: null,
  counterpartyAddress: null,
  network: null,
  fee: null,
  source: { file: null, line: null },
  status: 'new',
  existingId: null,
  attachTo: null,
  flags: [],
  suggestion: null,
  ...patch,
});

const decide = (key: string, patch: Partial<Decision> = {}): Decision => ({
  key,
  include: true,
  type: 'expense',
  categoryId: CAT,
  personId: null,
  clientId: null,
  description: null,
  attachTo: null,
  ...patch,
});

describe('planCommit', () => {
  it('books an exchange from both legs and its fee, keeping their references', () => {
    const rows = [
      row('debit'),
      row('credit', { accountId: B, direction: 'in', amount: '4400', currency: 'UAH' }),
      row('fee', { accountId: B, amount: '8.8', currency: 'UAH' }),
    ];
    const plan = planCommit(rows, [
      decide('debit', { type: 'fx_exchange' }),
      decide('credit', { attachTo: 'debit' }),
      decide('fee', { attachTo: 'debit' }),
    ])._unsafeUnwrap();
    expect(plan.items).toEqual([
      expect.objectContaining({
        externalRef: 'privat:debit',
        type: 'fx_exchange',
        from: { account: A, amount: '100' },
        to: { account: B, amount: '4400' },
        fee: { account: B, amount: '8.8' },
        description: 'purpose debit · credit ref credit · fee ref fee',
      }),
    ]);
    expect(plan.touched.sort()).toEqual(['credit', 'debit', 'fee']);
  });

  it('links a matched row instead of booking it', () => {
    const plan = planCommit(
      [row('m', { status: 'match', existingId: A })],
      [decide('m')],
    )._unsafeUnwrap();
    expect(plan.items).toHaveLength(0);
    expect(plan.links).toEqual([{ key: 'm', id: A, externalRef: 'privat:m' }]);
  });

  it('never writes duplicates or rows before the opening date, even if ticked', () => {
    const plan = planCommit(
      [row('d', { status: 'duplicate' }), row('o', { status: 'before_opening' })],
      [decide('d'), decide('o')],
    )._unsafeUnwrap();
    expect(plan.items).toHaveLength(0);
    expect(plan.links).toHaveLength(0);
  });

  it.each([
    [
      'a leg attached to a matched row',
      [row('m', { status: 'match', existingId: A }), row('c', { direction: 'in', accountId: B })],
      [decide('m'), decide('c', { attachTo: 'm' })],
      'c',
      'import.attachTarget',
    ],
    [
      'a leg attached to an excluded row',
      [row('x'), row('c', { direction: 'in', accountId: B })],
      [decide('x', { include: false }), decide('c', { attachTo: 'x' })],
      'c',
      'import.attachTarget',
    ],
    [
      'two fees',
      [row('p'), row('f1'), row('f2')],
      [decide('p'), decide('f1', { attachTo: 'p' }), decide('f2', { attachTo: 'p' })],
      'p',
      'import.oneFee',
    ],
    [
      'a fee on top of the chain gas',
      [row('p', { fee: { accountId: GAS, amount: '1' } }), row('f')],
      [decide('p'), decide('f', { attachTo: 'p' })],
      'p',
      'import.oneFee',
    ],
    [
      'an exchange without its other leg',
      [row('p')],
      [decide('p', { type: 'fx_exchange' })],
      'p',
      'import.needsCounter',
    ],
    [
      'a leg on an expense',
      [row('p'), row('c', { direction: 'in', accountId: B })],
      [decide('p'), decide('c', { attachTo: 'p' })],
      'p',
      'import.needsTwoLegType',
    ],
    [
      'income for money out',
      [row('p')],
      [decide('p', { type: 'revenue' })],
      'p',
      'import.revenueIsIn',
    ],
    [
      'an expense for money in',
      [row('p', { direction: 'in' })],
      [decide('p')],
      'p',
      'import.expenseIsOut',
    ],
    ['no category', [row('p')], [decide('p', { categoryId: null })], 'p', 'ledger.chooseCategory'],
    [
      'a person and a client',
      [row('p')],
      [decide('p', { personId: A, clientId: B })],
      'p',
      'ledger.oneParty',
    ],
  ] as const)('refuses %s', (_name, rows, decisions, key, message) => {
    const errors = planCommit(rows, decisions)._unsafeUnwrapErr();
    expect(errors[`rows.${key}`]).toContain(message);
  });
});
