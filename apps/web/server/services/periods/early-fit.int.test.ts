import {
  account,
  adjustment,
  allocation,
  assignment,
  billingTerms,
  client,
  company,
  contract,
  invoice,
  invoiceLine,
  payee,
  payrollItem,
  payrollLine,
  payTerms,
  period,
  person,
  posting,
  supplierAct,
  timesheet,
  transaction,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { payItem } from '../payroll';
import { refreshPayability } from '../payroll/payability';
import { addAdjustment, closePeriod, openPeriod } from '.';

// March 2054: an act issued before the close for the internal role and an expense only; the client
// work comes into the payout at the close (A-139).
const h = intHarness('2054-03-20');
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  client: '',
  contracts: [] as string[],
  person: '',
  payee: '',
  work: '',
  internal: '',
  period: '',
  act: '',
  uah: '',
};

beforeAll(async () => {
  owner = await h.user('owner');
  const [co] = await h.db.insert(company).values({ nameEn: 'F', nameUa: 'Ф' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Fit Client' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Fit Person' }).returning();
  const [py] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Підгонка', personId: p?.id })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: py?.id })
    .where(eq(person.id, p?.id ?? ''));
  const [clientContract, fopContract] = await h.db
    .insert(contract)
    .values([
      { kind: 'client', number: 'Fit MSA', companyId: co?.id ?? '', clientId: cl?.id },
      { kind: 'fop', number: 'Fit OD', companyId: co?.id ?? '', payeeId: py?.id, currency: 'UAH' },
    ])
    .returning();
  const [work] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', contractId: clientContract?.id, startsOn: '2054-01-01' })
    .returning();
  await h.db
    .insert(billingTerms)
    .values({ assignmentId: work?.id ?? '', validFrom: '2054-01-01', type: 'hourly', rate: '50' });
  const [internal] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2054-01-01' })
    .returning();
  await h.db.insert(payTerms).values([
    {
      assignmentId: work?.id ?? '',
      validFrom: '2054-01-01',
      type: 'fixed',
      amount: '4000',
      releasePolicy: 'immediate',
    },
    {
      assignmentId: internal?.id ?? '',
      validFrom: '2054-01-01',
      type: 'fixed',
      amount: '1000',
      releasePolicy: 'immediate',
    },
  ]);
  const [uah] = await h.db
    .insert(account)
    .values({ name: 'Fit UAH', kind: 'bank', currency: 'UAH', openingDate: '2054-01-01' })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    client: cl?.id,
    contracts: [clientContract?.id, fopContract?.id],
    person: p?.id,
    payee: py?.id,
    work: work?.id,
    internal: internal?.id,
    uah: uah?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor', 'system:test', true), set_config('app.reason', 'test cleanup', true)`,
      );
      await tx.execute(sql`set local session_replication_role = replica`);
      const txIds = tx
        .select({ id: posting.transactionId })
        .from(posting)
        .where(eq(posting.accountId, ids.uah));
      const booked = (await txIds).map((r) => r.id);
      if (booked.length) {
        await tx.delete(allocation).where(inArray(allocation.transactionId, booked));
        await tx.delete(posting).where(inArray(posting.transactionId, booked));
        await tx.delete(transaction).where(inArray(transaction.id, booked));
      }
      await tx.delete(supplierAct).where(eq(supplierAct.payeeId, ids.payee));
      if (ids.period) {
        const items = tx
          .select({ id: payrollItem.id })
          .from(payrollItem)
          .where(eq(payrollItem.periodId, ids.period));
        await tx.delete(payrollLine).where(inArray(payrollLine.payrollItemId, items));
        await tx.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
        const invoices = tx
          .select({ id: invoice.id })
          .from(invoice)
          .where(eq(invoice.periodId, ids.period));
        await tx.delete(invoiceLine).where(inArray(invoiceLine.invoiceId, invoices));
        await tx.delete(invoice).where(eq(invoice.periodId, ids.period));
        await tx.delete(adjustment).where(eq(adjustment.periodId, ids.period));
        await tx.delete(timesheet).where(eq(timesheet.periodId, ids.period));
        await tx.delete(period).where(eq(period.id, ids.period));
      }
    });
    await db.delete(account).where(eq(account.id, ids.uah));
    await db.delete(assignment).where(inArray(assignment.id, [ids.work, ids.internal]));
    await db.delete(contract).where(inArray(contract.id, ids.contracts));
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, ids.person));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const acts = () =>
  h.db
    .select()
    .from(supplierAct)
    .where(eq(supplierAct.payeeId, ids.payee))
    .orderBy(supplierAct.periodFrom);

describe('an act issued before the close for part of the pay (A-139)', () => {
  it('becomes the act of its work at the close, and a draft takes the rest', async () => {
    ids.period = (
      await openPeriod.run(h.ctxFor(owner), { month: '2054-03-01' })
    )._unsafeUnwrap().id;
    await addAdjustment.run(h.ctxFor(owner), {
      periodId: ids.period,
      personId: ids.person,
      kind: 'other',
      amount: '500',
      currency: 'UAH',
      reason: 'Licences',
    });
    // Signed in Vchasno for 1 000 $ × 42 + 500 ₴, before the client work was in the pay.
    const [early] = await h.db
      .insert(supplierAct)
      .values({
        contractId: ids.contracts[1] ?? '',
        payeeId: ids.payee,
        type: 'monthly',
        actDate: '2054-03-31',
        periodFrom: '2054-03-10',
        periodTo: '2054-03-31',
        amountUah: '42500.00',
        fxRate: '42.000000',
        fxSource: 'manual',
        status: 'issued',
        number: 'Fit OD - А1',
        snapshot: { version: 1 },
        signedUrl: 'https://edo.vchasno.ua/app/documents/fit',
      })
      .returning();
    ids.act = early?.id ?? '';

    expect((await closePeriod.run(h.ctxFor(owner), { periodId: ids.period })).isOk()).toBe(true);
    const [item] = await h.db
      .select()
      .from(payrollItem)
      .where(and(eq(payrollItem.periodId, ids.period), eq(payrollItem.personId, ids.person)));
    expect(item?.totalUah).toBe('210500.00');

    const [fitted, rest] = await acts();
    expect(fitted).toMatchObject({
      id: ids.act,
      status: 'issued',
      amountUah: '42500.00',
      amountUsd: '1000.00000000',
      assignmentIds: [ids.internal],
      payrollItemId: item?.id,
    });
    expect(rest).toMatchObject({
      status: 'draft',
      amountUsd: null,
      amountUah: '168000.00',
      periodFrom: '2054-04-01',
      payrollItemId: item?.id,
    });
    const lines = await h.db
      .select()
      .from(payrollLine)
      .where(eq(payrollLine.payrollItemId, item?.id ?? ''));
    expect(lines.find((l) => l.assignmentId === ids.internal)?.supplierActId).toBe(ids.act);
    expect(lines.find((l) => l.assignmentId === ids.work)?.supplierActId).toBeNull();
    const [cost] = await h.db.select().from(adjustment).where(eq(adjustment.periodId, ids.period));
    expect(cost?.supplierActId).toBe(ids.act);

    // Nothing more to fit: the refresh leaves the acts as they are.
    await refreshPayability(h.db, h.today);
    expect(await acts()).toHaveLength(2);

    const paid = await payItem.run(h.ctxFor(owner), {
      itemId: item?.id ?? '',
      accountId: ids.uah,
      occurredOn: '2054-03-31',
      amount: '42500.00',
      actId: ids.act,
    });
    expect(paid.isOk()).toBe(true);
  });
});
