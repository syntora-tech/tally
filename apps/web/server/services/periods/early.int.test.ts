import {
  adjustment,
  assignment,
  billingTerms,
  client,
  company,
  contract,
  fxRate,
  invoice,
  invoiceLine,
  payee,
  payrollItem,
  payrollLine,
  payTerms,
  period,
  person,
  supplierAct,
  timesheet,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import {
  addAdjustment,
  closePeriod,
  draftEarlyAct,
  draftEarlyInvoice,
  openPeriod,
  periodDocuments,
  setHours,
} from '.';

// March 2042, still open on 20.03; the NBU rate of that day is stored so no network is used.
const h = intHarness('2042-03-20');
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  client: '',
  contracts: [] as string[],
  person: '',
  payee: '',
  assignment: '',
  period: '',
  rate: '',
};

beforeAll(async () => {
  owner = await h.user('owner');
  const [co] = await h.db.insert(company).values({ nameEn: 'E', nameUa: 'Е' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Early Client' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Early Person' }).returning();
  const [py] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Ранній', personId: p?.id })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: py?.id })
    .where(eq(person.id, p?.id ?? ''));
  const [clientContract, fopContract] = await h.db
    .insert(contract)
    .values([
      { kind: 'client', number: 'Early MSA', companyId: co?.id ?? '', clientId: cl?.id },
      {
        kind: 'fop',
        number: 'Early OD',
        companyId: co?.id ?? '',
        payeeId: py?.id,
        currency: 'UAH',
      },
    ])
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', contractId: clientContract?.id, startsOn: '2042-01-01' })
    .returning();
  await h.db
    .insert(billingTerms)
    .values({ assignmentId: a?.id ?? '', validFrom: '2042-01-01', type: 'hourly', rate: '50' });
  await h.db.insert(payTerms).values({
    assignmentId: a?.id ?? '',
    validFrom: '2042-01-01',
    type: 'fixed',
    amount: '1000',
    releasePolicy: 'immediate',
  });
  const [r] = await h.db
    .insert(fxRate)
    .values({ onDate: '2042-03-20', base: 'USD', quote: 'UAH', rate: '41', source: 'nbu' })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    client: cl?.id,
    contracts: [clientContract?.id, fopContract?.id],
    person: p?.id,
    payee: py?.id,
    assignment: a?.id,
    rate: r?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor', 'system:test', true), set_config('app.reason', 'test cleanup', true)`,
      );
      // Issued documents are immutable (I1); only a replica session may remove them, and it skips
      // FK cascades, so children go first.
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.payeeId, ids.payee));
      if (ids.period) {
        const items = tx
          .select({ id: payrollItem.id })
          .from(payrollItem)
          .where(eq(payrollItem.periodId, ids.period));
        await tx.delete(supplierAct).where(inArray(supplierAct.payrollItemId, items));
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
    await db.delete(fxRate).where(eq(fxRate.id, ids.rate));
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
    await db.delete(contract).where(inArray(contract.id, ids.contracts));
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, ids.person));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const ctx = () => h.ctxFor(owner);
const myInvoice = async () =>
  (
    await h.db
      .select()
      .from(invoice)
      .where(eq(invoice.contractId, ids.contracts[0] ?? ''))
  )[0];
const myAct = async () =>
  (
    await h.db
      .select()
      .from(supplierAct)
      .where(and(eq(supplierAct.payeeId, ids.payee), eq(supplierAct.type, 'monthly')))
  )[0];
const hours = (value: string, payHours?: string) =>
  setHours.run(ctx(), {
    periodId: ids.period,
    assignmentId: ids.assignment,
    hours: value,
    ...(payHours === undefined ? {} : { payHours }),
  });

describe('documents before the period closes (A-076)', () => {
  it('an early invoice draft follows the hours', async () => {
    ids.period = (await openPeriod.run(ctx(), { month: '2042-03' }))._unsafeUnwrap().id;
    await hours('100');
    const drafted = await draftEarlyInvoice.run(ctx(), {
      periodId: ids.period,
      contractId: ids.contracts[0],
    });
    expect(drafted.isOk()).toBe(true);
    expect(await myInvoice()).toMatchObject({ status: 'draft', total: '5000.00000000' });
    expect((await hours('120')).isOk()).toBe(true);
    expect(await myInvoice()).toMatchObject({ status: 'draft', total: '6000.00000000' });
  });

  it('an early act takes the approved rate and follows adjustments', async () => {
    const docs = (await periodDocuments.run(ctx(), { periodId: ids.period }))._unsafeUnwrap();
    expect(docs.nbuRate).toBe('41.000000');
    expect(docs.acts.find((a) => a.personId === ids.person)).toMatchObject({
      usd: '1000.00',
      needsRate: true,
      act: null,
    });
    const drafted = await draftEarlyAct.run(ctx(), {
      periodId: ids.period,
      personId: ids.person,
      rate: '40',
    });
    expect(drafted.isOk()).toBe(true);
    expect(await myAct()).toMatchObject({
      status: 'draft',
      amountUah: '40000.00',
      fxRate: '40.000000',
      fxSource: 'manual',
      payrollItemId: null,
    });
    await addAdjustment.run(ctx(), {
      periodId: ids.period,
      personId: ids.person,
      kind: 'bonus',
      amount: '500',
      currency: 'UAH',
      reason: 'early test',
    });
    expect(await myAct()).toMatchObject({ amountUah: '40500.00' });
  });

  it('issued documents freeze the hours and adjustments they cover', async () => {
    await h.db
      .update(invoice)
      .set({ status: 'issued', number: 'E-1', snapshot: {} })
      .where(eq(invoice.id, (await myInvoice())?.id ?? ''));
    const billed = await hours('130');
    expect(billed._unsafeUnwrapErr().message).toContain('periods.hoursInvoiced');
    // Paid hours are not on the invoice and may still change.
    expect((await hours('120', '125')).isOk()).toBe(true);

    await h.db
      .update(supplierAct)
      .set({ status: 'issued', number: 'A-1', snapshot: {} })
      .where(eq(supplierAct.id, (await myAct())?.id ?? ''));
    const paid = await hours('120', '140');
    expect(paid._unsafeUnwrapErr().message).toContain('periods.hoursActed');
    const adjusted = await addAdjustment.run(ctx(), {
      periodId: ids.period,
      personId: ids.person,
      kind: 'bonus',
      amount: '1',
      currency: 'UAH',
      reason: 'late',
    });
    expect(adjusted._unsafeUnwrapErr().message).toContain('periods.adjustmentActed');
  });

  it('closing keeps the issued invoice, takes the act rate and links the issued act', async () => {
    expect((await closePeriod.run(ctx(), { periodId: ids.period })).isOk()).toBe(true);
    const invoices = await h.db
      .select()
      .from(invoice)
      .where(eq(invoice.contractId, ids.contracts[0] ?? ''));
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: 'issued', number: 'E-1' });
    const [item] = await h.db
      .select()
      .from(payrollItem)
      .where(eq(payrollItem.personId, ids.person));
    expect(item).toMatchObject({
      payoutFxRate: '40.000000',
      fxSource: 'manual',
      totalUah: '40500.00',
    });
    expect(await myAct()).toMatchObject({ status: 'issued', payrollItemId: item?.id });
  });
});
