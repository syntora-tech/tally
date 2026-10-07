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
import { listPayroll, payItem, setPayoutRate } from '.';

// September 2049: one 5 000 $ line, acts of 4 000 $ and of the rest planned before paying (A-086).
const h = intHarness('2049-10-16');
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
  const [co] = await h.db.insert(company).values({ nameEn: 'Amounts', nameUa: 'Суми' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Amounts Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Суми', personId: p?.id ?? null })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9049', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2049-01-01' })
    .returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2049-09-01', workHours: '176' })
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
      name: `Amounts UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2049-01-01',
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

describe('acts split off by amount (A-086)', () => {
  it('splits a USD share into its own act that follows the rate until paid', async () => {
    await setPayoutRate.run(h.ctxFor(finance), { itemId: ids.item, rate: '41.5' });
    const [whole] = await h.db.transaction((tx) =>
      ensureMonthlyActDraft(tx, ids.item).then((a) => [a]),
    );
    const tooBig = await splitActByActivity.run(h.ctxFor(finance), {
      actId: whole?.id ?? '',
      amountUsd: '5000',
      periodFrom: '2049-09-01',
      periodTo: '2049-09-16',
    });
    expect(tooBig._unsafeUnwrapErr().fieldErrors?.amountUsd).toBeDefined();

    const split = await splitActByActivity.run(h.ctxFor(finance), {
      actId: whole?.id ?? '',
      amountUsd: '4000',
      periodFrom: '2049-09-01',
      periodTo: '2049-09-16',
    });
    expect(split.isOk()).toBe(true);
    expect(await acts()).toMatchObject([
      { periodTo: '2049-09-16', amountUsd: '4000.00000000', amountUah: '166000.00' },
      { periodFrom: '2049-09-17', amountUsd: null, amountUah: '41500.00' },
    ]);

    await setPayoutRate.run(h.ctxFor(finance), { itemId: ids.item, rate: '42' });
    const [first] = await acts();
    expect(first?.amountUah).toBe('168000.00');
    const paid = await payItem.run(h.ctxFor(finance), {
      itemId: ids.item,
      accountId: ids.account,
      occurredOn: '2049-10-16',
      amount: '168000',
      actId: first?.id,
    });
    ids.transactions.push(paid._unsafeUnwrap().transactionId);
    await setPayoutRate.run(h.ctxFor(finance), { itemId: ids.item, rate: '43' });
    expect(await acts()).toMatchObject([
      { amountUah: '168000.00', rateLocked: true },
      { amountUsd: null, amountUah: '43000.00' },
    ]);
  });

  it('merges an amount act back into the rest', async () => {
    const [a, b] = await acts();
    const merged = await mergeActs.run(h.ctxFor(finance), {
      firstId: a?.id ?? '',
      secondId: b?.id ?? '',
    });
    expect(merged.isOk()).toBe(true);
    expect(await acts()).toMatchObject([
      { periodFrom: '2049-09-01', periodTo: '2049-09-30', amountUsd: null, amountUah: '211000.00' },
    ]);
    const [row] = (
      await listPayroll.run(h.ctxFor(finance), { periodId: ids.period })
    )._unsafeUnwrap();
    expect(row?.acts).toHaveLength(1);
  });
});
