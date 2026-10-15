import {
  account,
  adjustment,
  assignment,
  payrollItem,
  payrollLine,
  period,
  person,
} from '@tally/db/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { payItem } from '.';

// A payout whose client work still waits: the released work plus the adjustments is no advance.
const h = intHarness('2061-04-05');
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = { person: '', assignments: [] as string[], period: '', item: '', account: '' };

beforeAll(async () => {
  owner = await h.user('owner');
  const [p] = await h.db.insert(person).values({ fullName: 'Advance Person' }).returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2061-03-01', workHours: '184' })
    .returning();
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: per?.id ?? '',
      personId: p?.id ?? '',
      payoutMethod: 'fiat',
      totalUsd: '1500',
      payoutFxRate: '40.000000',
      fxSource: 'manual',
      totalUah: '62644.00',
    })
    .returning();
  for (const [amount, status] of [
    ['1000', 'payable'],
    ['500', 'awaiting_client'],
  ] as const) {
    const [a] = await h.db
      .insert(assignment)
      .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2061-01-01' })
      .returning();
    ids.assignments.push(a?.id ?? '');
    await h.db.insert(payrollLine).values({
      payrollItemId: item?.id ?? '',
      assignmentId: a?.id ?? '',
      amount,
      status,
      ...(status === 'payable' && { fundingSource: 'company' as const }),
    });
  }
  await h.db.insert(adjustment).values({
    periodId: per?.id ?? '',
    personId: p?.id ?? '',
    kind: 'other',
    amount: '2644',
    currency: 'UAH',
    reason: 'Services paid by the person',
  });
  await h.db.execute(sql`select public.refresh_payroll_item(${item?.id ?? ''})`);
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `Advance UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2061-01-01',
    })
    .returning();
  Object.assign(ids, { person: p?.id, period: per?.id, item: item?.id, account: acc?.id });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.allocation where payroll_item_id = ${ids.item}`);
      const txIds = await tx.execute<{ id: string }>(
        sql`select distinct transaction_id as id from public.posting where account_id = ${ids.account}`,
      );
      await tx.execute(
        sql`delete from public.posting where transaction_id in (select transaction_id from public.posting where account_id = ${ids.account})`,
      );
      for (const { id } of txIds) {
        await tx.execute(sql`delete from public.transaction where id = ${id}`);
      }
      await tx.delete(adjustment).where(eq(adjustment.periodId, ids.period));
      await tx.delete(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    });
    await db.delete(account).where(eq(account.id, ids.account));
    await db.delete(period).where(eq(period.id, ids.period));
    for (const id of ids.assignments) await db.delete(assignment).where(eq(assignment.id, id));
    await db.delete(person).where(eq(person.id, ids.person));
  }),
);

const pay = (amount: string) =>
  payItem.run(h.ctxFor(owner), {
    itemId: ids.item,
    accountId: ids.account,
    occurredOn: '2061-04-05',
    amount,
  });

describe('advance check of a payout with held work', () => {
  it('a payment over the released work and the adjustments is an advance', async () => {
    const [item] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(item?.totalUah).toBe('62644.00');
    expect((await pay('42644.01'))._unsafeUnwrapErr().message).toBe('payroll.advanceReason');
  });

  it('the released work with its adjustments is paid without an advance reason', async () => {
    expect((await pay('42644')).isOk()).toBe(true);
  });
});
