import {
  account,
  assignment,
  company,
  contract,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
  transaction,
} from '@tally/db/schema';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { ensureMonthlyActDraft, mergeActs, splitActByActivity } from '../acts';
import { payItem, setPayoutRate } from '.';

// September 2048: Boosty work and internal work of one person, an act for each (A-085).
const h = intHarness('2048-10-16');
let finance: Awaited<ReturnType<typeof h.user>>;
const lines = { boosty: '', internal: '' };
let assignmentB = '';
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  assignment: '',
  period: '',
  item: '',
  account: '',
  transactions: [] as string[],
};

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Activities', nameUa: 'Діяльності' })
    .returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Activities Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Діяльності', personId: p?.id ?? null })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9048', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({
      personId: p?.id ?? '',
      isInternal: true,
      startsOn: '2048-01-01',
      roleTitle: 'Boosty',
    })
    .returning();
  const [b] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2048-01-02', roleTitle: 'CTO' })
    .returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2048-09-01', workHours: '176' })
    .returning();
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: per?.id ?? '',
      personId: p?.id ?? '',
      payoutMethod: 'fiat',
      payeeId: fop?.id ?? null,
      totalUsd: '5000',
    })
    .returning();
  const [boosty, internal] = await h.db
    .insert(payrollLine)
    .values([
      {
        payrollItemId: item?.id ?? '',
        assignmentId: a?.id ?? '',
        amount: '4000',
        status: 'payable',
        fundingSource: 'company',
      },
      {
        payrollItemId: item?.id ?? '',
        assignmentId: b?.id ?? '',
        amount: '1000',
        status: 'payable',
        fundingSource: 'company',
      },
    ])
    .returning();
  lines.boosty = boosty?.id ?? '';
  lines.internal = internal?.id ?? '';
  assignmentB = b?.id ?? '';
  await h.db.execute(sql`select public.refresh_payroll_item(${item?.id ?? ''})`);
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `Activities UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2048-01-01',
    })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    person: p?.id,
    payee: fop?.id,
    contract: ct?.id,
    assignment: a?.id,
    period: per?.id,
    item: item?.id,
    account: acc?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(transaction).where(inArray(transaction.id, ids.transactions));
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    });
    await db.delete(account).where(eq(account.id, ids.account));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(assignment).where(inArray(assignment.id, [ids.assignment, assignmentB]));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const acts = () =>
  h.db
    .select()
    .from(supplierAct)
    .where(eq(supplierAct.payrollItemId, ids.item))
    .orderBy(asc(supplierAct.periodFrom));

describe('an act per activity (A-085)', () => {
  it('splits by activity; unpaid acts follow the rate, a paid one keeps it', async () => {
    await setPayoutRate.run(h.ctxFor(finance), { itemId: ids.item, rate: '41.5' });
    const [whole] = await h.db.transaction((tx) =>
      ensureMonthlyActDraft(tx, ids.item).then((a) => [a]),
    );
    const split = await splitActByActivity.run(h.ctxFor(finance), {
      actId: whole?.id ?? '',
      lineIds: [lines.boosty],
      periodFrom: '2048-09-01',
      periodTo: '2048-09-16',
    });
    expect(split.isOk()).toBe(true);
    expect(await acts()).toMatchObject([
      {
        periodFrom: '2048-09-01',
        periodTo: '2048-09-16',
        amountUsd: '4000.00000000',
        amountUah: '166000.00',
      },
      { periodFrom: '2048-09-17', periodTo: '2048-09-30', amountUsd: null, amountUah: '41500.00' },
    ]);
    const overlap = await splitActByActivity.run(h.ctxFor(finance), {
      actId: whole?.id ?? '',
      lineIds: [lines.internal],
      periodFrom: '2048-09-17',
      periodTo: '2048-09-30',
    });
    expect(overlap._unsafeUnwrapErr().message).toBe('acts.splitKeepSome');

    await setPayoutRate.run(h.ctxFor(finance), { itemId: ids.item, rate: '42' });
    const [boostyAct] = await acts();
    expect(boostyAct?.amountUah).toBe('168000.00');
    const paid = await payItem.run(h.ctxFor(finance), {
      itemId: ids.item,
      accountId: ids.account,
      occurredOn: '2048-10-16',
      amount: '168000',
      actId: boostyAct?.id,
    });
    ids.transactions.push(paid._unsafeUnwrap().transactionId);
    await setPayoutRate.run(h.ctxFor(finance), { itemId: ids.item, rate: '43' });
    expect(await acts()).toMatchObject([
      { amountUah: '168000.00', rateLocked: true },
      { amountUsd: null, amountUah: '43000.00' },
    ]);
  });

  it('merging sends the activities back to one act of the rest', async () => {
    const [a, b] = await acts();
    expect(
      (
        await mergeActs.run(h.ctxFor(finance), { firstId: a?.id ?? '', secondId: b?.id ?? '' })
      ).isOk(),
    ).toBe(true);
    const merged = await acts();
    expect(merged).toMatchObject([
      { periodFrom: '2048-09-01', periodTo: '2048-09-30', amountUsd: null, amountUah: '211000.00' },
    ]);
    const moved = await h.db
      .select()
      .from(payrollLine)
      .where(eq(payrollLine.payrollItemId, ids.item));
    expect(moved.every((l) => l.supplierActId === null)).toBe(true);
  });
});
