import { randomUUID } from 'node:crypto';
import {
  account,
  adjustment,
  assignment,
  allocation,
  category,
  company,
  contract,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  posting,
  supplierAct,
  transaction,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { adjustClosedPerson } from './closed-person';
import { adjustClosedPayout } from './lines';

// October 2048 is closed; its payout is paid in part: an issued act of the CTO line at 45.15,
// the rest (a client line) waits in the draft act of the rest — as Vladyslav's October (A-142).
const h = intHarness('2048-11-27');
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  period: '',
  item: '',
  paidAct: '',
  restAct: '',
  account: '',
  assignments: [] as string[],
  txs: [] as string[],
};

beforeAll(async () => {
  owner = await h.user('owner');
  const [co] = await h.db.insert(company).values({ nameEn: 'PP', nameUa: 'ЧО' }).returning();
  ids.company = co?.id ?? '';
  const [p] = await h.db.insert(person).values({ fullName: 'Partly Paid Person' }).returning();
  ids.person = p?.id ?? '';
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Частково', personId: p?.id ?? null })
    .returning();
  ids.payee = fop?.id ?? '';
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9048', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  ids.contract = ct?.id ?? '';
  for (const roleTitle of ['CTO', 'Backend']) {
    const [a] = await h.db
      .insert(assignment)
      .values({ personId: ids.person, isInternal: true, roleTitle, startsOn: '2048-01-01' })
      .returning();
    ids.assignments.push(a?.id ?? '');
  }
  const [per] = await h.db
    .insert(period)
    .values({ month: '2048-10-01', workHours: '184' })
    .returning();
  ids.period = per?.id ?? '';
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: per?.id ?? '',
      personId: p?.id ?? '',
      payoutMethod: 'fiat',
      payeeId: fop?.id ?? null,
      totalUsd: '3000',
      totalUah: '135450.00',
      payoutFxRate: '45.150000',
      fxSource: 'nbu',
    })
    .returning();
  ids.item = item?.id ?? '';
  const act = {
    contractId: ct?.id ?? '',
    payeeId: ids.payee,
    payrollItemId: item?.id ?? '',
    type: 'monthly' as const,
  };
  const [paidAct, restAct] = await h.db
    .insert(supplierAct)
    .values([
      {
        ...act,
        actDate: '2048-10-20',
        periodFrom: '2048-10-01',
        periodTo: '2048-10-20',
        amountUah: '45150.00',
        amountUsd: '1000',
        fxRate: '45.150000',
        fxSource: 'nbu',
      },
      {
        ...act,
        actDate: '2048-10-30',
        periodFrom: '2048-10-21',
        periodTo: '2048-10-31',
        amountUah: '90300.00',
      },
    ])
    .returning();
  const line = {
    payrollItemId: item?.id ?? '',
    currency: 'USD',
    status: 'payable' as const,
    fundingSource: 'company' as const,
  };
  await h.db.insert(payrollLine).values([
    {
      ...line,
      assignmentId: ids.assignments[0] ?? '',
      amount: '1000',
      supplierActId: paidAct?.id ?? null,
    },
    { ...line, assignmentId: ids.assignments[1] ?? '', amount: '2000' },
  ]);
  await h.db
    .update(supplierAct)
    .set({ status: 'issued', number: 'OD-9048 - А1', snapshot: {}, rateLocked: true })
    .where(eq(supplierAct.id, paidAct?.id ?? ''));
  await h.db
    .update(period)
    .set({ status: 'closed' })
    .where(eq(period.id, per?.id ?? ''));
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `pp ${randomUUID()}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2048-10-01',
    })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    person: p?.id,
    payee: fop?.id,
    contract: ct?.id,
    period: per?.id,
    item: item?.id,
    paidAct: paidAct?.id,
    restAct: restAct?.id,
    account: acc?.id,
  });
  await pay('45150.00');
});

async function pay(amount: string) {
  const [cat] = await h.db.select().from(category).where(eq(category.txType, 'expense')).limit(1);
  const txId = await h.db.transaction(async (tx) => {
    const [t] = await tx
      .insert(transaction)
      .values({ occurredOn: '2048-11-05', type: 'expense', categoryId: cat?.id ?? '' })
      .returning();
    await tx.insert(posting).values({
      transactionId: t?.id ?? '',
      accountId: ids.account,
      amount: `-${amount}`,
      currency: 'UAH',
    });
    await tx
      .insert(allocation)
      .values({ transactionId: t?.id ?? '', amount, currency: 'UAH', payrollItemId: ids.item });
    return t?.id ?? '';
  });
  ids.txs.push(txId);
}

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(allocation).where(inArray(allocation.transactionId, ids.txs));
      await tx.delete(posting).where(inArray(posting.transactionId, ids.txs));
      await tx.delete(transaction).where(inArray(transaction.id, ids.txs));
      if (ids.account) await tx.delete(account).where(eq(account.id, ids.account));
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(adjustment).where(eq(adjustment.periodId, ids.period));
      await tx.delete(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
      await tx.delete(period).where(eq(period.id, ids.period));
    });
    await db.delete(assignment).where(inArray(assignment.id, ids.assignments));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const actOf = async (id: string) =>
  (await h.db.select().from(supplierAct).where(eq(supplierAct.id, id)))[0];
const itemNow = async () =>
  (await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item)))[0];

describe('an adjustment of a payout of a closed month paid in part (A-142)', () => {
  const input = () => ({
    periodId: ids.period,
    personId: ids.person,
    payoutMethod: 'fiat' as const,
    amount: '100',
    currency: 'USD',
    reason: 'October bonus after the close',
  });

  it('goes into the draft act of the rest; the paid act stays as it is', async () => {
    expect(await itemNow()).toMatchObject({ status: 'partially_paid' });
    const done = (await adjustClosedPerson.run(h.ctxFor(owner), input()))._unsafeUnwrap();
    expect(done).toMatchObject({ created: false, itemId: ids.item, totalUah: '139965.00' });
    expect(await itemNow()).toMatchObject({ totalUsd: '3100.00000000', totalUah: '139965.00' });
    expect(await actOf(ids.paidAct)).toMatchObject({ amountUah: '45150.00', status: 'issued' });
    expect(await actOf(ids.restAct)).toMatchObject({ amountUah: '94815.00', status: 'draft' });
    const [added] = await h.db
      .select()
      .from(adjustment)
      .where(eq(adjustment.id, done.adjustmentId ?? ''));
    expect(added?.supplierActId).toBeNull();
  });

  it('refuses the paid act and an amount below what is paid', async () => {
    const intoPaid = await adjustClosedPayout.run(h.ctxFor(owner), {
      itemId: ids.item,
      amount: '5',
      reason: 'Into the paid act',
      actId: ids.paidAct,
    });
    expect(intoPaid._unsafeUnwrapErr().message).toBe('payroll.adjustActDraft');
    const below = await adjustClosedPerson.run(h.ctxFor(owner), { ...input(), amount: '-3000' });
    expect(below._unsafeUnwrapErr().message).toBe('payroll.adjustBelowPaid');
    expect(await itemNow()).toMatchObject({ totalUah: '139965.00' });
    expect(await actOf(ids.restAct)).toMatchObject({ amountUah: '94815.00' });
  });

  it('a payout paid in full takes no more adjustments', async () => {
    await pay('94815.00');
    expect(await itemNow()).toMatchObject({ status: 'paid' });
    const result = await adjustClosedPerson.run(h.ctxFor(owner), input());
    expect(result._unsafeUnwrapErr().message).toBe('payroll.lineItemPaid');
  });
});
