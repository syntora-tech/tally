import {
  assignment,
  billingTerms,
  client,
  company,
  contract,
  invoice,
  invoiceLine,
  payrollItem,
  payrollLine,
  payTerms,
  period,
  person,
  timesheet,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { closePeriod, getPeriodOverview, openPeriod, setHours } from '.';

// March 2040 (22 weekdays → 176 h), far from real periods in the shared DB.
const h = intHarness('2040-04-02');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = { company: '', client: '', contract: '', person: '', assignment: '', period: '' };

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'H', nameUa: 'Г' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Hours Client' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'client', number: 'Hours MSA', companyId: co?.id ?? '', clientId: cl?.id })
    .returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Hours Person' }).returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', contractId: ct?.id, startsOn: '2040-01-01' })
    .returning();
  await h.db
    .insert(billingTerms)
    .values({ assignmentId: a?.id ?? '', validFrom: '2040-01-01', type: 'hourly', rate: '47' });
  await h.db.insert(payTerms).values({
    assignmentId: a?.id ?? '',
    validFrom: '2040-01-01',
    type: 'hourly_rate',
    amount: '25',
  });
  Object.assign(ids, {
    company: co?.id,
    client: cl?.id,
    contract: ct?.id,
    person: p?.id,
    assignment: a?.id,
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
        await tx.update(period).set({ status: 'open' }).where(eq(period.id, ids.period));
        await tx.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
        if (invoiceIds.length) {
          await tx.delete(invoiceLine).where(inArray(invoiceLine.invoiceId, invoiceIds));
          await tx.delete(invoice).where(inArray(invoice.id, invoiceIds));
        }
        await tx.delete(timesheet).where(eq(timesheet.periodId, ids.period));
        await tx.delete(period).where(eq(period.id, ids.period));
      });
    }
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('client hours, person hours and hourly_rate pay (A-074)', () => {
  const entry = () => ({ periodId: ids.period, assignmentId: ids.assignment });
  const stored = async () =>
    (await h.db.select().from(timesheet).where(eq(timesheet.assignmentId, ids.assignment)))[0];

  it('stores person hours only when they differ from the client hours', async () => {
    ids.period = (await openPeriod.run(h.ctxFor(finance), { month: '2040-03' }))._unsafeUnwrap().id;
    await setHours.run(h.ctxFor(finance), { ...entry(), hours: '160', payHours: '160' });
    expect((await stored())?.payHours).toBeNull();
    await setHours.run(h.ctxFor(finance), { ...entry(), hours: '160', payHours: '172' });
    expect((await stored())?.payHours).toBe('172.00');
    // Omitted keeps the stored person hours.
    await setHours.run(h.ctxFor(finance), { ...entry(), hours: '160' });
    expect((await stored())?.payHours).toBe('172.00');
  });

  it('bills 47 × 160 and pays 25 × 172', async () => {
    const overview = (
      await getPeriodOverview.run(h.ctxFor(finance), { periodId: ids.period })
    )._unsafeUnwrap();
    const row = overview.preview.rows.find((r) => r.assignmentId === ids.assignment);
    expect(row).toMatchObject({
      hours: '160.00',
      payHours: '172.00',
      invoiceAmount: '7520.00',
      payUsd: '4300.00',
    });

    expect((await closePeriod.run(h.ctxFor(finance), { periodId: ids.period })).isOk()).toBe(true);
    const [inv] = await h.db.select().from(invoice).where(eq(invoice.contractId, ids.contract));
    expect(inv?.total).toBe('7520.00000000');
    const lines = await h.db
      .select({ amountUsd: payrollLine.amountUsd })
      .from(payrollLine)
      .innerJoin(payrollItem, eq(payrollItem.id, payrollLine.payrollItemId))
      .where(eq(payrollItem.personId, ids.person));
    expect(lines.map((l) => l.amountUsd)).toEqual(['4300.00000000']);
  });
});
