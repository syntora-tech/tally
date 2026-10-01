import { randomUUID } from 'node:crypto';
import { account, category, fxRate, posting, transaction } from '@tally/db/schema';
import { eq, gte, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { listAccounts } from '.';
import { addTransactions, setFxRates, upsertAccounts, upsertCategories } from './batch';

const h = intHarness('2045-03-10');
const tag = randomUUID().slice(0, 8);
const usd = `B ${tag} USD`;
const eur = `B ${tag} EUR`;
const ref = (n: number) => `int:${tag}:${String(n)}`;
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(transaction).where(like(transaction.externalRef, `int:${tag}:%`));
    await db.delete(account).where(like(account.name, `B ${tag}%`));
    await db.delete(category).where(like(category.name, `B ${tag}%`));
    await db.delete(fxRate).where(gte(fxRate.onDate, '2045-01-01'));
  }),
);

const accounts = [
  {
    name: usd,
    kind: 'bank',
    currency: 'USD',
    openingBalance: '1000',
    openingDate: '2045-01-01',
  },
  { name: eur, kind: 'bank', currency: 'EUR', openingBalance: '0', openingDate: '2045-01-01' },
];

describe('Ledger batch writes (13.3, A-053)', () => {
  it('creates accounts once; a dry run writes nothing; a repeat reports unchanged', async () => {
    const ctx = h.ctxFor(finance);
    const dry = await upsertAccounts.run(ctx, { accounts, dryRun: true });
    expect(dry._unsafeUnwrap().accounts.map((a) => a.status)).toEqual(['created', 'created']);
    expect(
      await h.db
        .select()
        .from(account)
        .where(like(account.name, `B ${tag}%`)),
    ).toHaveLength(0);

    const first = await upsertAccounts.run(ctx, { accounts });
    expect(first._unsafeUnwrap().accounts.map((a) => a.status)).toEqual(['created', 'created']);
    const again = await upsertAccounts.run(ctx, {
      accounts: [accounts[0], { ...accounts[1], openingBalance: '5' }],
    });
    expect(again._unsafeUnwrap().accounts.map((a) => a.status)).toEqual(['unchanged', 'updated']);
  });

  it('adds categories by (type, name) and rates with any quote', async () => {
    const ctx = h.ctxFor(finance);
    const cats = [{ txType: 'expense', name: `B ${tag} Fees` }];
    expect(
      (await upsertCategories.run(ctx, { categories: cats }))._unsafeUnwrap().categories[0],
    ).toMatchObject({ status: 'created' });
    expect(
      (await upsertCategories.run(ctx, { categories: cats }))._unsafeUnwrap().categories[0],
    ).toMatchObject({ status: 'existing' });

    const rates = await setFxRates.run(ctx, {
      rates: [
        { onDate: '2045-01-02', base: 'USD', rate: '43' },
        { onDate: '2045-01-02', base: 'EUR', quote: 'USD', rate: '1.168' },
      ],
    });
    expect(rates._unsafeUnwrap().saved).toBe(2);
    const stored = await h.db.select().from(fxRate).where(eq(fxRate.onDate, '2045-01-02'));
    expect(stored.map((r) => `${r.base}/${r.quote}`).sort()).toEqual(['EUR/USD', 'USD/UAH']);
  });

  it('books a batch by account and category names and skips known references', async () => {
    const ctx = h.ctxFor(finance);
    const batch = [
      {
        externalRef: ref(1),
        occurredOn: '2045-01-05',
        type: 'revenue',
        category: 'Client Revenue',
        to: { account: usd, amount: '500' },
        fee: { account: usd, amount: '2.50' },
      },
      {
        externalRef: ref(2),
        occurredOn: '2045-01-06',
        type: 'fx_exchange',
        category: 'FX Exchange',
        from: { account: usd, amount: '1400.20' },
        to: { account: eur, amount: '1198.80' },
      },
    ];
    const dry = await addTransactions.run(ctx, { transactions: batch, dryRun: true });
    expect(dry._unsafeUnwrap().created).toBe(2);
    expect(
      await h.db
        .select()
        .from(transaction)
        .where(like(transaction.externalRef, `int:${tag}:%`)),
    ).toHaveLength(0);

    const first = await addTransactions.run(ctx, { transactions: batch });
    expect(first._unsafeUnwrap()).toMatchObject({ created: 2, duplicates: 0 });
    const repeat = await addTransactions.run(ctx, { transactions: batch });
    expect(repeat._unsafeUnwrap()).toMatchObject({ created: 0, duplicates: 2 });

    const balances = (await listAccounts.run(ctx, {}))._unsafeUnwrap();
    const balance = (name: string) => balances.find((b) => b.account.name === name)?.balance;
    expect(balance(usd)).toBe('97.30000000');
    expect(balance(eur)).toBe('1203.80000000');
    const fees = await h.db
      .select()
      .from(posting)
      .where(inArray(posting.transactionId, [first._unsafeUnwrap().transactions[0]?.id ?? '']));
    expect(fees.map((p) => p.amount).sort()).toEqual(['-2.50000000', '500.00000000']);
  });

  it('reports per-item errors and writes nothing from a failing batch', async () => {
    const result = await addTransactions.run(h.ctxFor(finance), {
      transactions: [
        {
          externalRef: ref(3),
          occurredOn: '2045-01-07',
          type: 'expense',
          category: 'Client Revenue',
          from: { account: usd, amount: '10' },
        },
        {
          externalRef: ref(4),
          occurredOn: '2045-01-07',
          type: 'expense',
          category: `B ${tag} Fees`,
          from: { account: 'No such account', amount: '10' },
        },
        {
          externalRef: ref(5),
          occurredOn: '2045-01-07',
          type: 'expense',
          category: `B ${tag} Fees`,
          from: { account: usd, amount: '10' },
        },
      ],
    });
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('validation_error');
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(['transactions.0', 'transactions.1']);
    expect(
      await h.db
        .select()
        .from(transaction)
        .where(eq(transaction.externalRef, ref(5))),
    ).toHaveLength(0);
  });

  it('is denied to a viewer by RLS', async () => {
    const result = await addTransactions.run(h.ctxFor(viewer), {
      transactions: [
        {
          externalRef: ref(6),
          occurredOn: '2045-01-08',
          type: 'expense',
          category: `B ${tag} Fees`,
          from: { account: usd, amount: '1' },
        },
      ],
    });
    expect(result.isErr()).toBe(true);
  });
});
