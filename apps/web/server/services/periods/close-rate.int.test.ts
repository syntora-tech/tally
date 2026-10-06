import {
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
import { setPayoutRate } from '../payroll';
import { closePeriod, openPeriod, reopenPeriod, setHours } from '.';

// May 2041 closes on Monday 03.06.2041; the NBU rate of that day is stored so no network is used.
const h = intHarness('2041-06-03');
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
  const [co] = await h.db.insert(company).values({ nameEn: 'R', nameUa: 'Р' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Rate Client' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Rate Person' }).returning();
  const [py] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Курсовий', personId: p?.id })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: py?.id })
    .where(eq(person.id, p?.id ?? ''));
  const [clientContract, fopContract] = await h.db
    .insert(contract)
    .values([
      { kind: 'client', number: 'Rate MSA', companyId: co?.id ?? '', clientId: cl?.id },
      { kind: 'fop', number: 'Rate OD', companyId: co?.id ?? '', payeeId: py?.id, currency: 'UAH' },
    ])
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', contractId: clientContract?.id, startsOn: '2041-01-01' })
    .returning();
  await h.db
    .insert(billingTerms)
    .values({ assignmentId: a?.id ?? '', validFrom: '2041-01-01', type: 'hourly', rate: '50' });
  await h.db.insert(payTerms).values({
    assignmentId: a?.id ?? '',
    validFrom: '2041-01-01',
    type: 'fixed',
    amount: '1000',
    releasePolicy: 'immediate',
  });
  const [r] = await h.db
    .insert(fxRate)
    .values({ onDate: '2041-06-03', base: 'USD', quote: 'UAH', rate: '41.5', source: 'nbu' })
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
    if (ids.period) {
      const invoices = await db
        .select({ id: invoice.id })
        .from(invoice)
        .where(eq(invoice.periodId, ids.period));
      const invoiceIds = invoices.map((i) => i.id);
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.actor', 'system:test', true), set_config('app.reason', 'test cleanup', true)`,
        );
        // The act is issued and immutable (I1); only a replica session may remove it.
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.delete(supplierAct).where(eq(supplierAct.payeeId, ids.payee));
        await tx.update(period).set({ status: 'open' }).where(eq(period.id, ids.period));
        // Replica sessions skip FK cascades, so the lines go first.
        const items = tx
          .select({ id: payrollItem.id })
          .from(payrollItem)
          .where(eq(payrollItem.periodId, ids.period));
        await tx.delete(payrollLine).where(inArray(payrollLine.payrollItemId, items));
        await tx.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
        if (invoiceIds.length) {
          await tx.delete(invoiceLine).where(inArray(invoiceLine.invoiceId, invoiceIds));
          await tx.delete(invoice).where(inArray(invoice.id, invoiceIds));
        }
        await tx.delete(timesheet).where(eq(timesheet.periodId, ids.period));
        await tx.delete(period).where(eq(period.id, ids.period));
      });
    }
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

const item = async () =>
  (await h.db.select().from(payrollItem).where(eq(payrollItem.personId, ids.person)))[0];
const act = async () =>
  (
    await h.db
      .select()
      .from(supplierAct)
      .where(and(eq(supplierAct.payeeId, ids.payee), eq(supplierAct.type, 'monthly')))
  )[0];

describe('NBU rate at close and the FOP act draft (A-076)', () => {
  it('closing sets the NBU rate of the closing day and drafts the monthly act', async () => {
    ids.period = (await openPeriod.run(h.ctxFor(owner), { month: '2041-05' }))._unsafeUnwrap().id;
    await setHours.run(h.ctxFor(owner), {
      periodId: ids.period,
      assignmentId: ids.assignment,
      hours: '160',
    });
    expect((await closePeriod.run(h.ctxFor(owner), { periodId: ids.period })).isOk()).toBe(true);
    expect(await item()).toMatchObject({
      payoutFxRate: '41.500000',
      fxSource: 'nbu',
      totalUah: '41500.00',
    });
    expect(await act()).toMatchObject({
      status: 'draft',
      amountUah: '41500.00',
      payrollItemId: (await item())?.id,
    });
  });

  it('a corrected rate moves the draft act with it', async () => {
    const itemId = (await item())?.id ?? '';
    expect(
      (await setPayoutRate.run(h.ctxFor(owner), { itemId, rate: '42', source: 'manual' })).isOk(),
    ).toBe(true);
    expect(await act()).toMatchObject({ amountUah: '42000.00' });
  });

  it('reopening keeps the draft act and the next close links it again', async () => {
    const actId = (await act())?.id;
    expect(
      (await reopenPeriod.run(h.ctxFor(owner), { periodId: ids.period, reason: 'fix' })).isOk(),
    ).toBe(true);
    expect(await act()).toMatchObject({ id: actId, payrollItemId: null });
    expect((await closePeriod.run(h.ctxFor(owner), { periodId: ids.period })).isOk()).toBe(true);
    expect(await act()).toMatchObject({
      id: actId,
      payrollItemId: (await item())?.id,
      amountUah: '41500.00',
    });
  });

  it('an issued act freezes the rate and the period', async () => {
    await h.db
      .update(supplierAct)
      .set({ status: 'issued', number: 'R-1', snapshot: {} })
      .where(eq(supplierAct.id, (await act())?.id ?? ''));
    const itemId = (await item())?.id ?? '';
    const changed = await setPayoutRate.run(h.ctxFor(owner), { itemId, rate: '43' });
    expect(changed._unsafeUnwrapErr().message).toContain('payroll.rateActIssued');
    const reopened = await reopenPeriod.run(h.ctxFor(owner), {
      periodId: ids.period,
      reason: 'fix',
    });
    expect(reopened._unsafeUnwrapErr().message).toContain('periods.actIssued');
  });
});
