import { account, category, fxRate, transaction } from '@tally/db/schema';
import { parseLocalDate } from '@tally/domain';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import type { Fetcher } from '../../fx/nbu';
import { createTransaction } from '../ledger';
import { ensureNbuRate, saveManualRate, suggestRate, syncNbuRates } from '.';

const h = intHarness('2036-09-21');
const d = (s: string) => parseLocalDate(s)._unsafeUnwrap();
let finance: Awaited<ReturnType<typeof h.user>>;
const accounts: string[] = [];
const txIds: string[] = [];

const fakeNbu =
  (rate: number): Fetcher =>
  (url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([{ cc: new URL(url).searchParams.get('valcode'), rate, exchangedate: '' }]),
    });

beforeAll(async () => {
  finance = await h.user('finance');
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (txIds.length) await db.delete(transaction).where(inArray(transaction.id, txIds));
    if (accounts.length) await db.delete(account).where(inArray(account.id, accounts));
    await db.delete(fxRate).where(gte(fxRate.onDate, '2036-01-01'));
  }),
);

describe('FX rates (5.4)', () => {
  it('fetches and caches the NBU rate; the cron keeps USD and EUR', async () => {
    const first = await ensureNbuRate(h.db, 'USD', d('2036-09-18'), fakeNbu(41.5));
    expect(first._unsafeUnwrap().rate).toBe('41.5');
    const cached = await ensureNbuRate(h.db, 'USD', d('2036-09-18'), fakeNbu(99));
    expect(cached._unsafeUnwrap().rate).toBe('41.500000');
    const synced = await syncNbuRates(h.db, d('2036-09-19'), fakeNbu(42));
    expect(synced.map((s) => s.currency)).toEqual(['USD', 'EUR']);
  });

  it('suggests nbu, then manual, and prefers a recent Ledger exchange', async () => {
    const nbu = await suggestRate.run(h.ctxFor(finance), {
      onDate: '2036-09-18',
      fetchMissing: false,
    });
    expect(nbu._unsafeUnwrap()).toMatchObject({ source: 'nbu', rate: '41.500000' });

    await saveManualRate.run(h.ctxFor(finance), {
      onDate: '2036-09-01',
      base: 'USD',
      rate: '40.9',
    });
    const manual = await suggestRate.run(h.ctxFor(finance), {
      onDate: '2036-09-25',
      fetchMissing: false,
    });
    expect(manual._unsafeUnwrap()).toMatchObject({ source: 'manual', rate: '40.900000' });

    const accs = await h.db
      .insert(account)
      .values([
        {
          name: `fx usd ${String(Date.now())}`,
          kind: 'bank',
          currency: 'USD',
          openingDate: '2036-01-01',
        },
        {
          name: `fx uah ${String(Date.now())}`,
          kind: 'bank',
          currency: 'UAH',
          openingDate: '2036-01-01',
        },
      ])
      .returning();
    accounts.push(...accs.map((a) => a.id));
    const [cat] = await h.db
      .select()
      .from(category)
      .where(and(eq(category.txType, 'fx_exchange'), eq(category.name, 'FX Exchange')));
    const ex = await createTransaction.run(h.ctxFor(finance), {
      type: 'fx_exchange',
      occurredOn: '2036-09-17',
      categoryId: cat?.id,
      from: { accountId: accs[0]?.id, amount: '2000' },
      to: { accountId: accs[1]?.id, amount: '86100' },
    });
    txIds.push(ex._unsafeUnwrap().id);
    const actual = await suggestRate.run(h.ctxFor(finance), {
      onDate: '2036-09-18',
      fetchMissing: false,
    });
    expect(actual._unsafeUnwrap()).toMatchObject({
      source: 'bank_actual',
      rate: '43.050000',
      onDate: '2036-09-17',
    });
  });
});
