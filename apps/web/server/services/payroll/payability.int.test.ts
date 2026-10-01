import {
  account,
  adjustment,
  assignment,
  billingTerms,
  client,
  company,
  contract,
  invoice,
  job,
  numberSequence,
  payrollItem,
  payrollLine,
  payTerms,
  period,
  person,
  timesheet,
  transaction,
} from '@tally/db/schema';
import { parseLocalDate } from '@tally/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness, purgeProtected } from '../../../test/int-helpers';
import { issueInvoice, reissueInvoice, voidInvoice } from '../invoices';
import { closePeriod, openPeriod, setHours } from '../periods';
import { listPayroll, payItem } from '.';
import { overridePayable, refreshPayability } from './payability';

// Spec 9.4 calendar shifted to 2043, where 20 September is also a Sunday: invoice 01.09, due 20.09,
// payout deadline Monday 21.09.
const h = intHarness('2043-09-01');
const d = (s: string) => parseLocalDate(s)._unsafeUnwrap();
const SEQUENCE = 'test:int-payability';
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  client: '',
  contract: '',
  people: [] as string[],
  assignments: [] as string[],
  period: '',
  accounts: [] as string[],
  transactions: [] as string[],
};

const lineOf = async (assignmentId: string) => {
  const [l] = await h.db
    .select()
    .from(payrollLine)
    .where(eq(payrollLine.assignmentId, assignmentId));
  return l;
};
const invoicesOfPeriod = () =>
  h.db.select().from(invoice).where(eq(invoice.periodId, ids.period)).orderBy(invoice.createdAt);

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  await h.db.insert(numberSequence).values({ key: SEQUENCE, template: 'Y{seq}/{yy}' });
  const [co] = await h.db.insert(company).values({ nameEn: 'Y', nameUa: 'Й' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Payability client' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'client',
      number: 'PAY-1',
      companyId: co?.id ?? '',
      clientId: cl?.id ?? '',
      numberSequenceKey: SEQUENCE,
    })
    .returning();
  Object.assign(ids, { company: co?.id, client: cl?.id, contract: ct?.id });
  for (const name of ['Early Bird', 'Deadline Dev']) {
    const [p] = await h.db.insert(person).values({ fullName: name }).returning();
    const [a] = await h.db
      .insert(assignment)
      .values({ personId: p?.id ?? '', contractId: ct?.id ?? null, startsOn: '2043-01-01' })
      .returning();
    await h.db.insert(billingTerms).values({
      assignmentId: a?.id ?? '',
      validFrom: '2043-01-01',
      type: 'hourly',
      rate: '47',
      prorationPolicy: 'full_month',
    });
    await h.db.insert(payTerms).values({
      assignmentId: a?.id ?? '',
      validFrom: '2043-01-01',
      type: 'hourly',
      amount: '3000',
    });
    ids.people.push(p?.id ?? '');
    ids.assignments.push(a?.id ?? '');
  }
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (ids.transactions.length) {
      await db.delete(transaction).where(inArray(transaction.id, ids.transactions));
    }
    if (ids.accounts.length) await db.delete(account).where(inArray(account.id, ids.accounts));
    const invs = await db
      .select({ id: invoice.id })
      .from(invoice)
      .where(eq(invoice.periodId, ids.period));
    await db.delete(job).where(
      inArray(
        sql`${job.payload} ->> 'invoiceId'`,
        invs.map((i) => i.id),
      ),
    );
    await purgeProtected(db, { periodId: ids.period });
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(adjustment).where(eq(adjustment.periodId, ids.period));
      await tx.delete(timesheet).where(eq(timesheet.periodId, ids.period));
      await tx.delete(period).where(eq(period.id, ids.period));
    });
    await db.delete(assignment).where(inArray(assignment.id, ids.assignments));
    await db.delete(person).where(inArray(person.id, ids.people));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(numberSequence).where(eq(numberSequence.key, SEQUENCE));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('pay-when-paid (5.3, 9.4)', () => {
  it('closing August creates lines that wait for the client', async () => {
    ids.period = (await openPeriod.run(h.ctxFor(finance), { month: '2043-08' }))._unsafeUnwrap().id;
    for (const a of ids.assignments) {
      await setHours.run(h.ctxFor(finance), { periodId: ids.period, assignmentId: a, hours: '10' });
    }
    await closePeriod.run(h.ctxFor(finance), { periodId: ids.period });
    for (const a of ids.assignments) {
      expect(await lineOf(a)).toMatchObject({ status: 'awaiting_client', fundingSource: null });
    }
  });

  it('scenario 5: void + reissue moves the funding link to the new invoice', async () => {
    const [draft] = await invoicesOfPeriod();
    await issueInvoice.run(h.ctxFor(finance), { id: draft?.id ?? '', issueDate: '2043-09-01' });
    await voidInvoice.run(h.ctxFor(finance), { id: draft?.id ?? '', reason: 'Wrong rate' });
    const copy = (
      await reissueInvoice.run(h.ctxFor(finance), { id: draft?.id ?? '' })
    )._unsafeUnwrap();
    const issued = await issueInvoice.run(h.ctxFor(finance), {
      id: copy.id,
      issueDate: '2043-09-01',
    });
    expect(issued._unsafeUnwrap().number).toBe('Y2/43');
    const line = await lineOf(ids.assignments[0] ?? '');
    const [funding] = await h.db
      .select({ invoiceId: sql<string>`il.invoice_id` })
      .from(sql`public.invoice_line il`)
      .where(sql`il.id = ${line?.fundedByInvoiceLineId}`);
    expect(funding?.invoiceId).toBe(copy.id);
  });

  it('scenario 4: a 50 % payment on 18.09 keeps lines waiting', async () => {
    const issued = (await invoicesOfPeriod()).find((i) => i.status === 'issued');
    await h.payInvoice(issued?.id ?? '', '470', '2043-09-18');
    await refreshPayability(h.db, d('2043-09-18'));
    for (const a of ids.assignments) {
      expect((await lineOf(a))?.status).toBe('awaiting_client');
    }
  });

  it('only the owner releases a line early, with a reason', async () => {
    const line = await lineOf(ids.assignments[0] ?? '');
    const byFinance = await overridePayable.run(h.ctxFor(finance), {
      lineId: line?.id ?? '',
      reason: 'Advance agreed',
    });
    expect(byFinance._unsafeUnwrapErr().code).toBe('forbidden');
    await overridePayable.run(h.ctxFor(owner), {
      lineId: line?.id ?? '',
      reason: 'Advance agreed',
    });
    expect(await lineOf(ids.assignments[0] ?? '')).toMatchObject({
      status: 'payable',
      fundingSource: 'company',
      overrideReason: 'Advance agreed',
    });
  });

  it('scenario 2: on the deadline Monday 21.09 the rest is payable at company expense', async () => {
    await refreshPayability(h.db, d('2043-09-20'));
    expect((await lineOf(ids.assignments[1] ?? ''))?.status).toBe('awaiting_client');
    await refreshPayability(h.db, d('2043-09-21'));
    expect(await lineOf(ids.assignments[1] ?? '')).toMatchObject({
      status: 'payable',
      fundingSource: 'company',
    });
    const items = await h.db
      .select()
      .from(payrollItem)
      .where(and(eq(payrollItem.periodId, ids.period), inArray(payrollItem.personId, ids.people)));
    expect(items.every((i) => i.status === 'payable')).toBe(true);
  });

  it('scenario 3: a late payment closes the debt but funding stays with the company', async () => {
    const issued = (await invoicesOfPeriod()).find((i) => i.status === 'partially_paid');
    await h.payInvoice(issued?.id ?? '', '470', '2043-09-25');
    const [inv] = await h.db
      .select()
      .from(invoice)
      .where(eq(invoice.id, issued?.id ?? ''));
    expect(inv?.status).toBe('paid');
    expect((await lineOf(ids.assignments[1] ?? ''))?.fundingSource).toBe('company');
  });

  it('pays a fiat item: rate snapshot, UAH expense and allocation mark it paid (6.6)', async () => {
    const [uah] = await h.db
      .insert(account)
      .values({
        name: `Payroll UAH ${String(Date.now())}`,
        kind: 'bank',
        currency: 'UAH',
        openingDate: '2043-01-01',
      })
      .returning();
    ids.accounts.push(uah?.id ?? '');
    const queue = (
      await listPayroll.run(h.ctxFor(finance, d('2043-09-22')), { periodId: ids.period })
    )._unsafeUnwrap();
    const target = queue.find((q) => q.item.personId === ids.people[1]);
    expect(target?.group).toBe('ready');

    const tooMuch = await payItem.run(h.ctxFor(finance), {
      itemId: target?.item.id ?? '',
      accountId: uah?.id ?? '',
      occurredOn: '2043-09-22',
      amount: '999999',
      rate: '44.48',
      rateSource: 'nbu',
    });
    expect(tooMuch._unsafeUnwrapErr().fieldErrors?.overrideReason).toBeDefined();

    const [rated] = await h.db
      .select()
      .from(payrollItem)
      .where(eq(payrollItem.id, target?.item.id ?? ''));
    const paid = await payItem.run(h.ctxFor(finance), {
      itemId: target?.item.id ?? '',
      accountId: uah?.id ?? '',
      occurredOn: '2043-09-22',
      amount: rated?.totalUah ?? '0',
      rate: '44.48',
      rateSource: 'nbu',
    });
    ids.transactions.push(paid._unsafeUnwrap().transactionId);
    const [after] = await h.db
      .select()
      .from(payrollItem)
      .where(eq(payrollItem.id, target?.item.id ?? ''));
    expect(after).toMatchObject({ status: 'paid', fxSource: 'nbu', payoutFxRate: '44.480000' });
    expect((await lineOf(ids.assignments[1] ?? ''))?.status).toBe('paid');
  });
});
