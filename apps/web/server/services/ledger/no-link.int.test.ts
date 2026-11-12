import { randomUUID } from 'node:crypto';
import { account, category, transaction } from '@tally/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { updateTransactions } from './batch';
import { createTransaction, listTransactions, markNoLink, saveAccount, updateTransaction } from '.';

const h = intHarness('2034-04-01');
const tag = randomUUID().slice(0, 8);
let finance: Awaited<ReturnType<typeof h.user>>;
let uah = '';
let uah2 = '';
let expenseCat = '';
let transferCat = '';

beforeAll(async () => {
  finance = await h.user('finance');
  const ctx = h.ctxFor(finance);
  const base = { openingBalance: '0', openingDate: '2034-01-01', isActive: 'on', kind: 'bank' };
  uah = (
    await saveAccount.run(ctx, { ...base, name: `N ${tag} UAH`, currency: 'UAH' })
  )._unsafeUnwrap().id;
  uah2 = (
    await saveAccount.run(ctx, { ...base, name: `N ${tag} UAH 2`, currency: 'UAH' })
  )._unsafeUnwrap().id;
  const cat = async (txType: 'expense' | 'transfer') =>
    (await h.db.select().from(category).where(eq(category.txType, txType)).limit(1))[0]?.id ?? '';
  expenseCat = await cat('expense');
  transferCat = await cat('transfer');
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(transaction).where(like(transaction.description, `N ${tag}%`));
    await db.delete(account).where(like(account.name, `N ${tag}%`));
  }),
);

const expense = async (description: string) =>
  (
    await createTransaction.run(h.ctxFor(finance), {
      type: 'expense',
      occurredOn: '2034-03-10',
      categoryId: expenseCat,
      description: `N ${tag} ${description}`,
      from: { accountId: uah, amount: '100' },
    })
  )._unsafeUnwrap().id;

const unallocatedIds = async () =>
  (
    await listTransactions.run(h.ctxFor(finance), {
      q: `N ${tag}`,
      unallocated: 'on',
      limit: 100,
    })
  )
    ._unsafeUnwrap()
    .map((r) => r.transaction.id);

it('a marked payment leaves the not-linked filter and comes back when the mark is off', async () => {
  const ctx = h.ctxFor(finance);
  const id = await expense('old');
  expect(await unallocatedIds()).toContain(id);

  const marked = await markNoLink.run(ctx, { ids: [id], reason: 'Before the books' });
  expect(marked.isOk()).toBe(true);
  expect(await unallocatedIds()).not.toContain(id);

  await markNoLink.run(ctx, { ids: [id], reason: '' });
  const [row] = await h.db.select().from(transaction).where(eq(transaction.id, id));
  expect(row?.noLinkReason).toBeNull();
  expect(await unallocatedIds()).toContain(id);
});

it('only income and expenses can be marked; the DB refuses a blank reason or a transfer', async () => {
  const ctx = h.ctxFor(finance);
  const transfer = (
    await createTransaction.run(ctx, {
      type: 'transfer',
      occurredOn: '2034-03-10',
      categoryId: transferCat,
      description: `N ${tag} transfer`,
      from: { accountId: uah, amount: '10' },
      to: { accountId: uah2, amount: '10' },
    })
  )._unsafeUnwrap().id;
  const refused = await markNoLink.run(ctx, { ids: [transfer], reason: 'x' });
  expect(refused._unsafeUnwrapErr().fieldErrors).toEqual({ 'ids.0': ['ledger.noLinkNotSettling'] });

  const id = await expense('blank');
  await expect(
    h.db.update(transaction).set({ noLinkReason: '  ' }).where(eq(transaction.id, id)),
  ).rejects.toThrow();
  await expect(
    h.db.update(transaction).set({ noLinkReason: 'x' }).where(eq(transaction.id, transfer)),
  ).rejects.toThrow();
});

it('changing a marked expense into a transfer drops the mark', async () => {
  const ctx = h.ctxFor(finance);
  const id = await expense('retyped');
  await markNoLink.run(ctx, { ids: [id], reason: 'Bank fee' });
  const edited = await updateTransaction.run(ctx, {
    id,
    type: 'transfer',
    occurredOn: '2034-03-10',
    categoryId: transferCat,
    description: `N ${tag} retyped`,
    from: { accountId: uah, amount: '100' },
    to: { accountId: uah2, amount: '100' },
  });
  expect(edited.isOk()).toBe(true);
  const [row] = await h.db.select().from(transaction).where(eq(transaction.id, id));
  expect(row).toMatchObject({ type: 'transfer', noLinkReason: null });
});

it('MCP update_transactions sets and clears the mark', async () => {
  const ctx = h.ctxFor(finance);
  const id = await expense('mcp');
  const set = await updateTransactions.run(ctx, {
    transactions: [{ id, noLinkReason: 'August payout, before the books' }],
  });
  expect(set._unsafeUnwrap().transactions).toEqual([{ index: 0, id, status: 'updated' }]);
  const [row] = await h.db
    .select()
    .from(transaction)
    .where(and(eq(transaction.id, id)));
  expect(row?.noLinkReason).toBe('August payout, before the books');

  await updateTransactions.run(ctx, { transactions: [{ id, noLinkReason: null }] });
  expect(await unallocatedIds()).toContain(id);
});
