import {
  account,
  agencyTerms,
  assignment,
  billingTerms,
  client,
  company,
  contract,
  invoice,
  job,
  numberSequence,
  payee,
  payrollItem,
  payrollLine,
  payTerms,
  period,
  person,
  supplierAct,
  timesheet,
  transaction,
} from '@tally/db/schema';
import { toDecimal } from '@tally/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness, purgeProtected } from '../../../test/int-helpers';
import { addAgencyVersion } from '../assignments';
import { monthMargin } from '../dashboard/margin';
import { issueInvoice } from '../invoices';
import { closePeriod, openPeriod, setHours } from '../periods';
import { listPayroll, payItem } from '.';

const h = intHarness('2047-04-01');
const INVOICE_SEQ = 'test:int-agency-inv';
const ACT_SEQ = 'test:int-agency-act';
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  client: '',
  contract: '',
  agencyContract: '',
  person: '',
  agency: '',
  assignment: '',
  period: '',
  account: '',
  transactions: [] as string[],
};

const agencyItem = async () => {
  const [row] = await h.db
    .select()
    .from(payrollItem)
    .where(and(eq(payrollItem.periodId, ids.period), eq(payrollItem.kind, 'agency')));
  return row;
};
const agencyLine = async () => {
  const [row] = await h.db
    .select()
    .from(payrollLine)
    .where(and(eq(payrollLine.assignmentId, ids.assignment), eq(payrollLine.agencyFee, true)));
  return row;
};

beforeAll(async () => {
  finance = await h.user('finance');
  await h.db.insert(numberSequence).values([
    { key: INVOICE_SEQ, template: 'AG{seq}/{yy}' },
    { key: ACT_SEQ, template: 'AG - А{seq}' },
  ]);
  const [co] = await h.db.insert(company).values({ nameEn: 'Ag', nameUa: 'Аг' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Agency client' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'client',
      number: 'AG-1',
      companyId: co?.id ?? '',
      clientId: cl?.id ?? '',
      numberSequenceKey: INVOICE_SEQ,
    })
    .returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Placed Dev' }).returning();
  const [ag] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Агенція Інт' })
    .returning();
  const [agc] = await h.db
    .insert(contract)
    .values({
      kind: 'fop',
      number: 'AG-FOP-1',
      companyId: co?.id ?? '',
      payeeId: ag?.id ?? null,
      numberSequenceKey: ACT_SEQ,
    })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', contractId: ct?.id ?? null, startsOn: '2047-01-01' })
    .returning();
  await h.db.insert(billingTerms).values({
    assignmentId: a?.id ?? '',
    validFrom: '2047-01-01',
    type: 'hourly',
    rate: '47',
    prorationPolicy: 'full_month',
  });
  await h.db.insert(payTerms).values({
    assignmentId: a?.id ?? '',
    validFrom: '2047-01-01',
    type: 'hourly',
    amount: '3000',
  });
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `Agency UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2047-01-01',
    })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    client: cl?.id,
    contract: ct?.id,
    agencyContract: agc?.id,
    person: p?.id,
    agency: ag?.id,
    assignment: a?.id,
    account: acc?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (ids.transactions.length) {
      await db.delete(transaction).where(inArray(transaction.id, ids.transactions));
    }
    await db.delete(account).where(eq(account.id, ids.account));
    await db.delete(supplierAct).where(eq(supplierAct.payeeId, ids.agency));
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
      await tx.delete(timesheet).where(eq(timesheet.periodId, ids.period));
      await tx.delete(period).where(eq(period.id, ids.period));
      await tx.delete(agencyTerms).where(eq(agencyTerms.assignmentId, ids.assignment));
      await tx.delete(billingTerms).where(eq(billingTerms.assignmentId, ids.assignment));
      await tx.delete(payTerms).where(eq(payTerms.assignmentId, ids.assignment));
    });
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
    await db.delete(contract).where(inArray(contract.id, [ids.contract, ids.agencyContract]));
    await db.delete(payee).where(eq(payee.id, ids.agency));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(numberSequence).where(inArray(numberSequence.key, [INVOICE_SEQ, ACT_SEQ]));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('agency fees (A-068)', () => {
  it('closing a month accrues rate × hours to the agency as its own payout', async () => {
    const noPayee = await addAgencyVersion.run(h.ctxFor(finance), {
      assignmentId: ids.assignment,
      validFrom: '2047-01',
      ratePerHour: '4',
    });
    expect(noPayee._unsafeUnwrapErr().fieldErrors?.payeeId).toBeDefined();
    (
      await addAgencyVersion.run(h.ctxFor(finance), {
        assignmentId: ids.assignment,
        validFrom: '2047-01',
        payeeId: ids.agency,
        ratePerHour: '4',
      })
    )._unsafeUnwrap();

    ids.period = (await openPeriod.run(h.ctxFor(finance), { month: '2047-03' }))._unsafeUnwrap().id;
    await setHours.run(h.ctxFor(finance), {
      periodId: ids.period,
      assignmentId: ids.assignment,
      hours: '160',
    });
    (await closePeriod.run(h.ctxFor(finance), { periodId: ids.period }))._unsafeUnwrap();

    expect(await agencyItem()).toMatchObject({
      kind: 'agency',
      personId: null,
      payeeId: ids.agency,
      totalUsd: '640.00000000',
      status: 'draft',
    });
    expect(await agencyLine()).toMatchObject({
      amountUsd: '640.00000000',
      status: 'awaiting_client',
    });
    const queue = (
      await listPayroll.run(h.ctxFor(finance), { periodId: ids.period })
    )._unsafeUnwrap();
    const ours = queue.filter((q) => q.item.kind === 'agency' || q.item.personId === ids.person);
    expect(ours.map((q) => q.item.kind).sort()).toEqual(['agency', 'person']);
    expect(queue.find((q) => q.item.kind === 'agency')?.lines[0]?.personName).toBe('Placed Dev');
  });

  it('waits for the client like the pay, then is paid with an act to the agency', async () => {
    const [draft] = await h.db.select().from(invoice).where(eq(invoice.periodId, ids.period));
    (
      await issueInvoice.run(h.ctxFor(finance), { id: draft?.id ?? '', issueDate: '2047-04-01' })
    )._unsafeUnwrap();
    await h.payInvoice(draft?.id ?? '', '7520', '2047-04-10');
    expect(await agencyLine()).toMatchObject({ status: 'payable', fundingSource: 'client' });

    const item = await agencyItem();
    const paid = await payItem.run(h.ctxFor(finance), {
      itemId: item?.id ?? '',
      accountId: ids.account,
      occurredOn: '2047-04-12',
      amount: '26240',
      rate: '41',
      rateSource: 'manual',
    });
    const value = paid._unsafeUnwrap();
    ids.transactions.push(value.transactionId);
    const [tx] = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.id, value.transactionId));
    expect(tx).toMatchObject({ counterparty: 'ФОП Агенція Інт', personId: null });
    const [act] = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.id, value.actId ?? ''));
    expect(act).toMatchObject({
      payeeId: ids.agency,
      contractId: ids.agencyContract,
      amountUah: '26240.00',
    });
    expect((await agencyItem())?.status).toBe('paid');
  });

  it('the month margin takes the agency fee off the client and the person (6.1)', async () => {
    const [p] = await h.db.select().from(period).where(eq(period.id, ids.period));
    const pay = toDecimal('3000')
      .div(p?.workHours ?? '1')
      .times('160')
      .toFixed(2);
    const margin = (
      await monthMargin.run(h.ctxFor(finance), { periodId: ids.period })
    )._unsafeUnwrap();
    const expected = {
      revenueUsd: '7520.00',
      payUsd: pay,
      agencyUsd: '640.00',
      marginUsd: toDecimal('7520').minus(pay).minus('640').toFixed(2),
    };
    expect(margin?.byClient.find((r) => r.id === ids.client)).toMatchObject(expected);
    expect(margin?.byPerson.find((r) => r.id === ids.person)).toMatchObject(expected);
  });
});
