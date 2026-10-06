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
import { mergeActs } from '../acts';
import { listPayroll, payItem, setPayoutRate } from '.';

// September 2047: work paid in October, first 4 000 $ when the client pays, then the rest.
const h = intHarness('2047-10-16');
let finance: Awaited<ReturnType<typeof h.user>>;
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
    .values({ nameEn: 'Parts', nameUa: 'Частини' })
    .returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Parts Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Частини', personId: p?.id ?? null })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9047', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2047-01-01' })
    .returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2047-09-01', workHours: '176' })
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
  await h.db.insert(payrollLine).values({
    payrollItemId: item?.id ?? '',
    assignmentId: a?.id ?? '',
    amount: '5000',
    status: 'payable',
    fundingSource: 'company',
  });
  await h.db.execute(sql`select public.refresh_payroll_item(${item?.id ?? ''})`);
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `Parts UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2047-01-01',
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
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
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

describe('a month paid in parts, an act per part (A-083)', () => {
  it('splits the act at the first payment and pays the rest at a later rate', async () => {
    const first = await payItem.run(h.ctxFor(finance), {
      itemId: ids.item,
      accountId: ids.account,
      occurredOn: '2047-10-16',
      amount: '166000',
      rate: '41.5',
      rateSource: 'manual',
    });
    ids.transactions.push(first._unsafeUnwrap().transactionId);
    expect(await acts()).toMatchObject([
      {
        periodFrom: '2047-09-01',
        periodTo: '2047-09-16',
        actDate: '2047-09-16',
        amountUsd: '4000.00000000',
        amountUah: '166000.00',
        fxRate: '41.500000',
      },
      { periodFrom: '2047-09-17', periodTo: '2047-09-30', amountUsd: null, amountUah: '41500.00' },
    ]);

    // The paid part keeps 41.5; the rest takes the new rate.
    const rated = await setPayoutRate.run(h.ctxFor(finance), { itemId: ids.item, rate: '42' });
    expect(rated._unsafeUnwrap().totalUah).toBe('208000.00');
    const [, rest] = await acts();
    expect(rest?.amountUah).toBe('42000.00');

    const second = await payItem.run(h.ctxFor(finance), {
      itemId: ids.item,
      accountId: ids.account,
      occurredOn: '2047-10-31',
      amount: '42000',
    });
    ids.transactions.push(second._unsafeUnwrap().transactionId);
    expect(await acts()).toHaveLength(2);
    const [row] = (
      await listPayroll.run(h.ctxFor(finance), { periodId: ids.period })
    )._unsafeUnwrap();
    expect(row).toMatchObject({ item: { status: 'paid' }, acts: [{}, {}] });
  });

  it('merges neighbouring draft acts into one act and one period', async () => {
    const [a, b] = await acts();
    const merged = await mergeActs.run(h.ctxFor(finance), {
      firstId: a?.id ?? '',
      secondId: b?.id ?? '',
    });
    expect(merged.isOk()).toBe(true);
    expect(await acts()).toMatchObject([
      { periodFrom: '2047-09-01', periodTo: '2047-09-30', amountUsd: null, amountUah: '208000.00' },
    ]);
  });
});
