import { account, category, transaction } from '@tally/db/schema';
import { toDecimal } from '@tally/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import {
  createTransaction,
  deleteTransaction,
  impliedRate,
  listAccounts,
  listTransactions,
  reconcileAccount,
  saveAccount,
} from '.';

const h = intHarness('2034-02-01');
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
const accounts: Record<string, string> = {};
const txIds: string[] = [];
const cats: Record<string, string> = {};

async function cat(type: 'revenue' | 'expense' | 'fx_exchange', name: string) {
  const [c] = await h.db
    .select()
    .from(category)
    .where(and(eq(category.txType, type), eq(category.name, name)));
  return c?.id ?? '';
}

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  for (const [key, currency] of [
    ['usd', 'USD'],
    ['uah', 'UAH'],
  ] as const) {
    const res = await saveAccount.run(h.ctxFor(finance), {
      name: `Int ledger ${key} ${String(Date.now())}`,
      kind: 'bank',
      currency,
      openingBalance: '100',
      openingDate: '2034-01-01',
      isActive: 'on',
    });
    accounts[key] = res._unsafeUnwrap().id;
  }
  cats.revenue = await cat('revenue', 'Client Revenue');
  cats.fx = await cat('fx_exchange', 'FX Exchange');
  cats.expense = await cat('expense', 'Bank Fees');
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (txIds.length) await db.delete(transaction).where(inArray(transaction.id, txIds));
    await db.delete(account).where(inArray(account.id, Object.values(accounts)));
  }),
);

describe('ledger services (6.7)', () => {
  it('books revenue with a fee and updates the balance', async () => {
    const res = await createTransaction.run(h.ctxFor(finance), {
      type: 'revenue',
      occurredOn: '2034-01-10',
      categoryId: cats.revenue,
      to: { accountId: accounts.usd, amount: '1000' },
      fee: { accountId: accounts.usd, amount: '5' },
    });
    txIds.push(res._unsafeUnwrap().id);
    const list = (await listAccounts.run(h.ctxFor(finance), {}))._unsafeUnwrap();
    expect(
      toDecimal(list.find((a) => a.account.id === accounts.usd)?.balance ?? '0').toFixed(2),
    ).toBe('1095.00');
  });

  it('books an exchange with two actual amounts and shows the implied rate', async () => {
    const exchange = await createTransaction.run(h.ctxFor(finance), {
      type: 'fx_exchange',
      occurredOn: '2034-01-11',
      categoryId: cats.fx,
      from: { accountId: accounts.usd, amount: '200' },
      to: { accountId: accounts.uah, amount: '8610' },
    });
    txIds.push(exchange._unsafeUnwrap().id);
    const rows = (
      await listTransactions.run(h.ctxFor(finance), { accountId: accounts.uah })
    )._unsafeUnwrap();
    expect(impliedRate(rows[0]?.postings ?? [])?.toFixed(6)).toBe('43.050000');
  });

  it('reconciles a statement balance on a date (6.7)', async () => {
    const usdOn = async (asOf: string) =>
      (await listAccounts.run(h.ctxFor(finance), { asOf }))
        ._unsafeUnwrap()
        .find((a) => a.account.id === accounts.usd)?.balance ?? '';
    expect(toDecimal(await usdOn('2034-01-10')).toFixed(2)).toBe('1095.00');
    expect(toDecimal(await usdOn('2034-01-11')).toFixed(2)).toBe('895.00');

    const off = await reconcileAccount.run(h.ctxFor(finance), {
      accountId: accounts.usd,
      onDate: '2034-01-10',
      statementBalance: '1090',
    });
    expect(toDecimal(off._unsafeUnwrap().difference).toFixed(2)).toBe('-5.00');
    const exact = await reconcileAccount.run(h.ctxFor(finance), {
      accountId: accounts.usd,
      onDate: '2034-01-11',
      statementBalance: '895',
    });
    expect(toDecimal(exact._unsafeUnwrap().difference).isZero()).toBe(true);
    const early = await reconcileAccount.run(h.ctxFor(finance), {
      accountId: accounts.usd,
      onDate: '2033-12-31',
      statementBalance: '100',
    });
    expect(early._unsafeUnwrapErr().fieldErrors?.onDate).toBeDefined();
  });

  it('rejects a revenue without an account and a category of another type', async () => {
    const noAccount = await createTransaction.run(h.ctxFor(finance), {
      type: 'revenue',
      occurredOn: '2034-01-12',
      categoryId: cats.revenue,
    });
    expect(noAccount._unsafeUnwrapErr().fieldErrors?.to).toBeDefined();
    const wrongCategory = await createTransaction.run(h.ctxFor(finance), {
      type: 'revenue',
      occurredOn: '2034-01-12',
      categoryId: cats.expense,
      to: { accountId: accounts.usd, amount: '1' },
    });
    expect(wrongCategory.isErr()).toBe(true);
  });

  it('keeps the currency of an account with postings', async () => {
    const res = await saveAccount.run(h.ctxFor(finance), {
      id: accounts.usd,
      name: 'Renamed',
      kind: 'bank',
      currency: 'EUR',
      openingBalance: '100',
      openingDate: '2034-01-01',
    });
    expect(res._unsafeUnwrapErr().fieldErrors?.currency).toBeDefined();
  });

  it('filters unallocated money and deletes a free transaction', async () => {
    const rows = (
      await listTransactions.run(h.ctxFor(finance), { unallocated: 'on', from: '2034-01-01' })
    )._unsafeUnwrap();
    expect(rows.map((r) => r.transaction.type)).toContain('revenue');
    const id = txIds.pop() ?? '';
    expect((await deleteTransaction.run(h.ctxFor(finance), { id })).isOk()).toBe(true);
  });

  it('hides the ledger from viewers', async () => {
    expect((await listAccounts.run(h.ctxFor(viewer), {}))._unsafeUnwrap()).toEqual([]);
  });
});
