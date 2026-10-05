import { randomUUID } from 'node:crypto';
import { account, category, person, posting, transaction } from '@tally/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { addWallet } from '../wallets';
import { createTransaction, saveAccount, updateTransaction } from '.';

const h = intHarness('2034-03-01');
const tag = randomUUID().slice(0, 8);
const hex = randomUUID().replaceAll('-', '');
const wallet = `0x${hex}${hex.slice(0, 8)}`;
let finance: Awaited<ReturnType<typeof h.user>>;
let usdc = '';
let usd = '';
let expenseCat = '';
let personId = '';

beforeAll(async () => {
  finance = await h.user('finance');
  const ctx = h.ctxFor(finance);
  const base = { openingBalance: '0', openingDate: '2034-01-01', isActive: 'on' };
  usdc = (
    await saveAccount.run(ctx, {
      ...base,
      name: `E ${tag} USDC`,
      kind: 'crypto',
      currency: 'USDC',
      network: 'ETH',
    })
  )._unsafeUnwrap().id;
  usd = (
    await saveAccount.run(ctx, { ...base, name: `E ${tag} USD`, kind: 'bank', currency: 'USD' })
  )._unsafeUnwrap().id;
  [{ id: personId }] = (await h.db
    .insert(person)
    .values({ fullName: `E ${tag} Payee` })
    .returning({ id: person.id })) as [{ id: string }];
  await addWallet.run(ctx, {
    personId,
    network: 'ETH',
    address: wallet.toUpperCase().replace('0X', '0x'),
  });
  const [c] = await h.db
    .select()
    .from(category)
    .where(and(eq(category.txType, 'expense'), eq(category.name, 'Bank Fees')));
  expenseCat = c?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(transaction).where(like(transaction.description, `E ${tag}%`));
    await db.delete(account).where(like(account.name, `E ${tag}%`));
    await db.delete(person).where(eq(person.id, personId));
  }),
);

const base = () => ({
  type: 'expense',
  occurredOn: '2034-02-10',
  categoryId: expenseCat,
  description: `E ${tag} payout`,
  from: { accountId: usdc, amount: '100' },
});

it('links a crypto payment to the owner of the counterparty wallet', async () => {
  const ctx = h.ctxFor(finance);
  const created = await createTransaction.run(ctx, { ...base(), counterpartyAddress: wallet });
  const [row] = await h.db
    .select()
    .from(transaction)
    .where(eq(transaction.id, created._unsafeUnwrap().id));
  expect(row).toMatchObject({ personId, clientId: null, counterpartyAddress: wallet });

  const bank = await createTransaction.run(ctx, {
    ...base(),
    from: { accountId: usd, amount: '5' },
    counterpartyAddress: wallet,
  });
  expect(bank._unsafeUnwrapErr().fieldErrors).toEqual({
    counterpartyAddress: ['ledger.addressNeedsCrypto'],
  });
});

it('edits every field of an unallocated transaction and rewrites its postings', async () => {
  const ctx = h.ctxFor(finance);
  const id = (await createTransaction.run(ctx, base()))._unsafeUnwrap().id;
  const same = await updateTransaction.run(ctx, { id, ...base() });
  expect(same._unsafeUnwrap().status).toBe('unchanged');

  const edited = await updateTransaction.run(ctx, {
    id,
    ...base(),
    occurredOn: '2034-02-11',
    description: `E ${tag} payout fixed`,
    externalRef: `0x${'c3'.repeat(32)}`,
    personId,
    from: { accountId: usd, amount: '99.5' },
    fee: { accountId: usd, amount: '0.5' },
  });
  expect(edited._unsafeUnwrap().status).toBe('updated');
  const [row] = await h.db.select().from(transaction).where(eq(transaction.id, id));
  expect(row).toMatchObject({ occurredOn: '2034-02-11', personId });
  const postings = await h.db.select().from(posting).where(eq(posting.transactionId, id));
  expect(postings.map((p) => [p.accountId, p.amount, p.currency, p.isFee]).sort()).toEqual(
    [
      [usd, '-0.50000000', 'USD', true],
      [usd, '-99.50000000', 'USD', false],
    ].sort(),
  );

  const both = await updateTransaction.run(ctx, { id, ...base(), personId, clientId: personId });
  expect(both._unsafeUnwrapErr().fieldErrors).toEqual({ clientId: ['ledger.oneParty'] });
});
