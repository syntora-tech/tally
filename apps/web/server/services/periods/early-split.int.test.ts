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
import { mergeActs, splitActByActivity } from '../acts';
import { addAdjustment, closePeriod, draftEarlyAct, openPeriod } from '.';

// March 2053: Boosty work and an internal role, split into two acts before the close (A-089).
const h = intHarness('2053-03-20');
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  client: '',
  contracts: [] as string[],
  person: '',
  payee: '',
  assignment: '',
  internal: '',
  period: '',
  rate: '',
};

beforeAll(async () => {
  owner = await h.user('owner');
  const [co] = await h.db.insert(company).values({ nameEn: 'E', nameUa: 'Е' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Split Client' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Split Person' }).returning();
  const [py] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Поділ', personId: p?.id })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: py?.id })
    .where(eq(person.id, p?.id ?? ''));
  const [clientContract, fopContract] = await h.db
    .insert(contract)
    .values([
      { kind: 'client', number: 'Split MSA', companyId: co?.id ?? '', clientId: cl?.id },
      {
        kind: 'fop',
        number: 'Split OD',
        companyId: co?.id ?? '',
        payeeId: py?.id,
        currency: 'UAH',
      },
    ])
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', contractId: clientContract?.id, startsOn: '2053-01-01' })
    .returning();
  await h.db
    .insert(billingTerms)
    .values({ assignmentId: a?.id ?? '', validFrom: '2053-01-01', type: 'hourly', rate: '50' });
  const [internal] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2053-01-01' })
    .returning();
  await h.db.insert(payTerms).values([
    {
      assignmentId: a?.id ?? '',
      validFrom: '2053-01-01',
      type: 'fixed',
      amount: '4000',
      releasePolicy: 'immediate',
    },
    {
      assignmentId: internal?.id ?? '',
      validFrom: '2053-01-01',
      type: 'fixed',
      amount: '1000',
      releasePolicy: 'immediate',
    },
  ]);
  const [r] = await h.db
    .insert(fxRate)
    .values({ onDate: '2053-03-20', base: 'USD', quote: 'UAH', rate: '41', source: 'nbu' })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    client: cl?.id,
    contracts: [clientContract?.id, fopContract?.id],
    person: p?.id,
    payee: py?.id,
    assignment: a?.id,
    internal: internal?.id,
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
    await db.delete(assignment).where(inArray(assignment.id, [ids.assignment, ids.internal]));
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

describe('acts of a month split before the close (A-089)', () => {
  it('splits by work, follows the approved rate and keeps the split at the close', async () => {
    ids.period = (
      await openPeriod.run(h.ctxFor(owner), { month: '2053-03-01' })
    )._unsafeUnwrap().id;
    const drafted = await draftEarlyAct.run(h.ctxFor(owner), {
      periodId: ids.period,
      personId: ids.person,
      rate: '41.5',
    });
    const split = await splitActByActivity.run(h.ctxFor(owner), {
      actId: drafted._unsafeUnwrap().id,
      assignmentIds: [ids.assignment],
      periodFrom: '2053-03-01',
      periodTo: '2053-03-16',
    });
    expect(split.isOk()).toBe(true);
    expect(await acts()).toMatchObject([
      { periodTo: '2053-03-16', amountUsd: '4000.00000000', amountUah: '166000.00' },
      { periodFrom: '2053-03-17', amountUsd: null, amountUah: '41500.00' },
    ]);
    const [boosty] = await acts();
    expect(boosty?.assignmentIds).toEqual([ids.assignment]);

    // A new adjustment goes into the act of the rest; a new rate moves every draft.
    await addAdjustment.run(h.ctxFor(owner), {
      periodId: ids.period,
      personId: ids.person,
      kind: 'bonus',
      amount: '100',
      currency: 'USD',
      reason: 'Bonus',
    });
    await draftEarlyAct.run(h.ctxFor(owner), {
      periodId: ids.period,
      personId: ids.person,
      rate: '42',
    });
    expect(await acts()).toMatchObject([{ amountUah: '168000.00' }, { amountUah: '46200.00' }]);

    const closed = await closePeriod.run(h.ctxFor(owner), { periodId: ids.period });
    expect(closed.isOk()).toBe(true);
    const linked = await acts();
    expect(linked).toMatchObject([
      { amountUah: '168000.00', amountUsd: '4000.00000000' },
      { amountUah: '46200.00', amountUsd: null },
    ]);
    const [item] = await h.db
      .select()
      .from(payrollItem)
      .where(and(eq(payrollItem.periodId, ids.period), eq(payrollItem.personId, ids.person)));
    expect(item?.payoutFxRate).toBe('42.000000');
    expect(linked.every((a) => a.payrollItemId === item?.id)).toBe(true);
    const lines = await h.db
      .select()
      .from(payrollLine)
      .where(eq(payrollLine.payrollItemId, item?.id ?? ''));
    expect(lines.find((l) => l.assignmentId === ids.assignment)?.supplierActId).toBe(boosty?.id);
    expect(lines.find((l) => l.assignmentId === ids.internal)?.supplierActId).toBeNull();
  });

  it('merges the acts back after the close', async () => {
    const [a, b] = await acts();
    const merged = await mergeActs.run(h.ctxFor(owner), {
      firstId: a?.id ?? '',
      secondId: b?.id ?? '',
    });
    expect(merged.isOk()).toBe(true);
    expect(await acts()).toMatchObject([
      { periodFrom: '2053-03-01', periodTo: '2053-03-31', amountUsd: null, assignmentIds: null },
    ]);
  });
});
