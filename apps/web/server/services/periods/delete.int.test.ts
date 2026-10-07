import { adjustment, period, person } from '@tally/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { addAdjustment, deletePeriod, openPeriod } from '.';

const h = intHarness('2051-11-03');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = { person: '', periods: [] as string[] };

beforeAll(async () => {
  finance = await h.user('finance');
  const [p] = await h.db.insert(person).values({ fullName: 'Delete Period' }).returning();
  ids.person = p?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    for (const id of ids.periods) {
      await db.delete(adjustment).where(eq(adjustment.periodId, id));
      await db.delete(period).where(eq(period.id, id));
    }
    await db.delete(person).where(eq(person.id, ids.person));
  }),
);

describe('deleting a period opened by mistake', () => {
  it('deletes an empty open period by month, dry run first', async () => {
    const opened = (
      await openPeriod.run(h.ctxFor(finance), { month: '2051-11-01' })
    )._unsafeUnwrap();
    ids.periods.push(opened.id);
    const dry = await deletePeriod.run(h.ctxFor(finance), { month: '2051-11-01', dryRun: true });
    expect(dry._unsafeUnwrap()).toMatchObject({ dryRun: true, deleted: { id: opened.id } });
    expect(await h.db.select().from(period).where(eq(period.id, opened.id))).toHaveLength(1);
    const done = await deletePeriod.run(h.ctxFor(finance), { periodId: opened.id });
    expect(done.isOk()).toBe(true);
    expect(await h.db.select().from(period).where(eq(period.id, opened.id))).toHaveLength(0);
  });

  it('refuses a period with something in it', async () => {
    const opened = (
      await openPeriod.run(h.ctxFor(finance), { month: '2051-12-01' })
    )._unsafeUnwrap();
    ids.periods.push(opened.id);
    const added = await addAdjustment.run(h.ctxFor(finance), {
      periodId: opened.id,
      personId: ids.person,
      kind: 'bonus',
      amount: '100',
      currency: 'USD',
      reason: 'Test',
    });
    expect(added.isOk()).toBe(true);
    const refused = await deletePeriod.run(h.ctxFor(finance), { periodId: opened.id });
    expect(refused._unsafeUnwrapErr().message).toBe('periods.deleteNotEmpty');
  });
});
