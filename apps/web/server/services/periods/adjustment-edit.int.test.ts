import {
  adjustment,
  company,
  contract,
  payee,
  payrollItem,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { addAdjustment, updateAdjustment } from '.';

// October 2052 is open, September is closed with an unpaid payout and its draft act (A-124).
const h = intHarness('2052-10-20');
let finance: Awaited<ReturnType<typeof h.user>>;
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  closed: '',
  open: '',
  item: '',
  act: '',
  closedAdjustment: '',
};

beforeAll(async () => {
  finance = await h.user('finance');
  owner = await h.user('owner');
  const [co] = await h.db.insert(company).values({ nameEn: 'Edit', nameUa: 'Зміна' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Edit Adjustment Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Зміна', personId: p?.id ?? null })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: fop?.id ?? null })
    .where(eq(person.id, p?.id ?? ''));
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9052', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  Object.assign(ids, { company: co?.id, person: p?.id, payee: fop?.id, contract: ct?.id });
  const [closed] = await h.db
    .insert(period)
    .values({ month: '2052-09-01', workHours: '176' })
    .returning();
  const [open] = await h.db
    .insert(period)
    .values({ month: '2052-10-01', workHours: '184' })
    .returning();
  ids.closed = closed?.id ?? '';
  ids.open = open?.id ?? '';
  const [j] = await h.db
    .insert(adjustment)
    .values({
      periodId: ids.closed,
      personId: ids.person,
      kind: 'other',
      amount: '1000',
      currency: 'UAH',
      reason: 'AWS',
    })
    .returning();
  ids.closedAdjustment = j?.id ?? '';
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: ids.closed,
      personId: ids.person,
      payoutMethod: 'fiat',
      payeeId: ids.payee,
      totalUsd: '0',
      totalUah: '1000.00',
    })
    .returning();
  ids.item = item?.id ?? '';
  const [act] = await h.db
    .insert(supplierAct)
    .values({
      contractId: ids.contract,
      payeeId: ids.payee,
      payrollItemId: ids.item,
      actDate: '2052-09-30',
      periodFrom: '2052-09-01',
      periodTo: '2052-09-30',
      amountUah: '1000.00',
    })
    .returning();
  ids.act = act?.id ?? '';
  await h.db.execute(sql`select public.refresh_payroll_item(${ids.item})`);
  await h.db.update(period).set({ status: 'closed' }).where(eq(period.id, ids.closed));
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(adjustment).where(inArray(adjustment.periodId, [ids.closed, ids.open]));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    });
    await db.delete(period).where(inArray(period.id, [ids.closed, ids.open]));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, ids.person));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const stored = async (id: string) =>
  (await h.db.select().from(adjustment).where(eq(adjustment.id, id)))[0];

describe('changing an adjustment until its payout is paid (A-124)', () => {
  it('in an open month: amount, currency, kind and reason; a deduction stays negative', async () => {
    const added = await addAdjustment.run(h.ctxFor(finance), {
      periodId: ids.open,
      personId: ids.person,
      kind: 'other',
      amount: '1828',
      currency: 'USD',
      reason: 'Compensation',
    });
    const id = added._unsafeUnwrap().id;
    const changed = await updateAdjustment.run(h.ctxFor(finance), {
      id,
      kind: 'other',
      amount: '1900',
      currency: 'USD',
      reason: 'Compensation: corporate services',
    });
    expect(changed.isOk()).toBe(true);
    expect(await stored(id)).toMatchObject({
      amount: '1900.00000000',
      reason: 'Compensation: corporate services',
      periodId: ids.open,
      personId: ids.person,
    });
    await updateAdjustment.run(h.ctxFor(finance), {
      id,
      kind: 'deduction',
      amount: '50',
      currency: 'UAH',
      reason: 'Laptop damage',
    });
    expect(await stored(id)).toMatchObject({ kind: 'deduction', amount: '-50.00000000' });
  });

  it('leaves a trip reimbursement to its trip', async () => {
    const [trip] = await h.db
      .insert(adjustment)
      .values({
        periodId: ids.open,
        personId: ids.person,
        kind: 'trip_reimbursement',
        amount: '500',
        currency: 'UAH',
        reason: 'Trip',
      })
      .returning();
    const result = await updateAdjustment.run(h.ctxFor(finance), {
      id: trip?.id ?? '',
      kind: 'other',
      amount: '600',
      currency: 'UAH',
      reason: 'Trip',
    });
    expect(result._unsafeUnwrapErr().message).toBe('periods.adjustmentTrip');
  });

  it('in a closed month only the owner; the unpaid payout and its draft act follow', async () => {
    const input = {
      id: ids.closedAdjustment,
      kind: 'other' as const,
      amount: '1200',
      currency: 'UAH',
      reason: 'AWS and Workspace',
    };
    expect((await updateAdjustment.run(h.ctxFor(finance), input))._unsafeUnwrapErr().message).toBe(
      'periods.adjustmentClosedOwner',
    );
    expect((await updateAdjustment.run(h.ctxFor(owner), input))._unsafeUnwrap()).toMatchObject({
      itemId: ids.item,
      totalUah: '1200.00',
    });
    const [item] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(item?.totalUah).toBe('1200.00');
    const [act] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act));
    expect(act?.amountUah).toBe('1200.00');
  });

  it('refuses once the act of the payout is issued', async () => {
    await h.db
      .update(supplierAct)
      .set({ status: 'issued', number: 'OD-9052 - А1', snapshot: {} })
      .where(eq(supplierAct.id, ids.act));
    const result = await updateAdjustment.run(h.ctxFor(owner), {
      id: ids.closedAdjustment,
      kind: 'other',
      amount: '1300',
      currency: 'UAH',
      reason: 'Late change',
    });
    expect(result._unsafeUnwrapErr().message).toBe('payroll.lineActIssued');
    expect((await stored(ids.closedAdjustment))?.amount).toBe('1200.00000000');
  });
});
