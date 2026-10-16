import { account } from '@tally/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { listAccounts, moveAccount, setAccountHidden } from '.';

const h = intHarness();
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
const tag = `Order ${String(Date.now())}`;
const ids: string[] = [];
// The move renumbers every account of the shared DB; put the others back afterwards.
let before: { id: string; position: number | null }[] = [];

const order = async () =>
  (await listAccounts.run(h.ctxFor(finance), {}))
    ._unsafeUnwrap()
    .map((r) => r.account.id)
    .filter((id) => ids.includes(id));

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  before = await h.db.select({ id: account.id, position: account.position }).from(account);
  const rows = await h.db
    .insert(account)
    .values(
      ['A', 'B', 'C'].map((n) => ({
        name: `${tag} ${n}`,
        kind: 'bank' as const,
        currency: 'USD',
        openingDate: '2026-01-01',
        openingBalance: '10',
      })),
    )
    .returning();
  ids.push(...rows.map((r) => r.id));
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(account).where(inArray(account.id, ids));
    for (const r of before) {
      await db.update(account).set({ position: r.position }).where(eq(account.id, r.id));
    }
  }),
);

describe('account order and visibility (A-106)', () => {
  it('moves an account up and down; the rest keep their relative order', async () => {
    const [a, b, c] = ids;
    expect(await order()).toEqual([a, b, c]);
    await moveAccount.run(h.ctxFor(finance), { id: c ?? '', direction: 'up' });
    expect(await order()).toEqual([a, c, b]);
    await moveAccount.run(h.ctxFor(finance), { id: a ?? '', direction: 'down' });
    expect(await order()).toEqual([c, a, b]);
    const all = (await listAccounts.run(h.ctxFor(finance), { includeInactive: true }))
      ._unsafeUnwrap()
      .map((r) => r.account.position);
    expect(all).toEqual(all.map((_, i) => i + 1));
  });

  it('keeps the first and the last in place at the edges', async () => {
    const first = (
      await listAccounts.run(h.ctxFor(finance), { includeInactive: true })
    )._unsafeUnwrap()[0]?.account.id;
    const was = await order();
    await moveAccount.run(h.ctxFor(finance), { id: first ?? '', direction: 'up' });
    expect(await order()).toEqual(was);
  });

  it('hides an account without dropping it from the list or its balance', async () => {
    const [a] = ids;
    await setAccountHidden.run(h.ctxFor(finance), { id: a ?? '', hidden: true });
    const row = (await listAccounts.run(h.ctxFor(finance), {}))
      ._unsafeUnwrap()
      .find((r) => r.account.id === a);
    expect(row?.account.isHidden).toBe(true);
    expect(row?.balance).toBe('10.00000000');
    await setAccountHidden.run(h.ctxFor(finance), { id: a ?? '', hidden: false });
  });

  it('leaves accounts alone for a viewer (RLS)', async () => {
    const res = await moveAccount.run(h.ctxFor(viewer), { id: ids[0] ?? '', direction: 'down' });
    expect(res.isErr()).toBe(true);
    const hide = await setAccountHidden.run(h.ctxFor(viewer), { id: ids[0] ?? '', hidden: true });
    expect(hide.isErr()).toBe(true);
  });
});
