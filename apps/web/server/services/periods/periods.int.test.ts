import {
  adjustment,
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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { sum } from '@tally/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import {
  addAdjustment,
  closePeriod,
  getPeriodOverview,
  openPeriod,
  reopenPeriod,
  setHours,
} from '.';

// A far-future July with the same calendar shape as July 2026 (23 weekdays → 184 h) keeps the test
// independent from real periods in the shared local database.
const h = intHarness('2037-08-03');
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  clients: [] as string[],
  contracts: [] as string[],
  people: [] as string[],
  assignments: {} as Record<string, string>,
  period: '',
};

async function makeAssignment(
  key: string,
  personName: string,
  contractId: string | null,
  billing: {
    type: 'hourly' | 'fixed_monthly' | 'none';
    rate: string;
    prorationPolicy?: 'full_month' | 'by_hours' | 'trunc_hourly';
  },
  pay: { type: 'fixed' | 'hourly' | 'included'; amount: string },
) {
  const [p] = await h.db.insert(person).values({ fullName: personName }).returning();
  const [a] = await h.db
    .insert(assignment)
    .values({
      personId: p?.id ?? '',
      contractId,
      isInternal: contractId === null,
      roleTitle: 'Developer',
      startsOn: '2037-01-01',
    })
    .returning();
  const assignmentId = a?.id ?? '';
  await h.db
    .insert(billingTerms)
    .values({ assignmentId, validFrom: '2037-01-01', prorationPolicy: 'full_month', ...billing });
  await h.db.insert(payTerms).values({ assignmentId, validFrom: '2037-01-01', ...pay });
  ids.people.push(p?.id ?? '');
  ids.assignments[key] = assignmentId;
}

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'P', nameUa: 'П' }).returning();
  ids.company = co?.id ?? '';
  for (const name of ['Trady P', 'IdeaSoft P', 'Boosty P']) {
    const [cl] = await h.db.insert(client).values({ legalName: name }).returning();
    const [ct] = await h.db
      .insert(contract)
      .values({
        kind: 'client',
        number: `${name} contract`,
        companyId: ids.company,
        clientId: cl?.id ?? '',
      })
      .returning();
    ids.clients.push(cl?.id ?? '');
    ids.contracts.push(ct?.id ?? '');
  }
  const [trady, ideasoft, boosty] = ids.contracts;
  await makeAssignment(
    'trady',
    'Vladyslav P',
    trady ?? null,
    { type: 'fixed_monthly', rate: '5500' },
    { type: 'hourly', amount: '5000' },
  );
  await makeAssignment(
    'ideasoft',
    'Andrii P',
    ideasoft ?? null,
    { type: 'hourly', rate: '47' },
    { type: 'hourly', amount: '3000' },
  );
  await makeAssignment(
    'sklyarov',
    'Sklyarov P',
    boosty ?? null,
    { type: 'hourly', rate: '45' },
    { type: 'hourly', amount: '7360' },
  );
  await makeAssignment(
    'ceo',
    'Dolina P',
    null,
    { type: 'none', rate: '0' },
    { type: 'fixed', amount: '2020' },
  );
});

afterAll(() =>
  h.cleanup(async (db) => {
    const invoices = await db
      .select({ id: invoice.id })
      .from(invoice)
      .where(inArray(invoice.contractId, ids.contracts));
    if (invoices.length) {
      await db.delete(invoiceLine).where(
        inArray(
          invoiceLine.invoiceId,
          invoices.map((i) => i.id),
        ),
      );
      await db.delete(invoice).where(
        inArray(
          invoice.id,
          invoices.map((i) => i.id),
        ),
      );
    }
    if (ids.period) {
      // Reopening needs a system actor and a reason (I6); only then can hours be removed.
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.actor', 'system:test', true), set_config('app.reason', 'test cleanup', true)`,
        );
        await tx.update(period).set({ status: 'open' }).where(eq(period.id, ids.period));
        await tx.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
        await tx.delete(adjustment).where(eq(adjustment.periodId, ids.period));
        await tx.delete(timesheet).where(eq(timesheet.periodId, ids.period));
        await tx.delete(period).where(eq(period.id, ids.period));
      });
    }
    await db.delete(assignment).where(inArray(assignment.id, Object.values(ids.assignments)));
    await db.delete(person).where(inArray(person.id, ids.people));
    await db.delete(contract).where(inArray(contract.id, ids.contracts));
    await db.delete(client).where(inArray(client.id, ids.clients));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('period wizard (spec 6.4)', () => {
  it('opens a period with the calendar norm (184 h for a 23-weekday July)', async () => {
    const res = await openPeriod.run(h.ctxFor(finance), {
      month: '2037-07',
      referenceFxUsdUah: '44.48',
    });
    ids.period = res._unsafeUnwrap().id;
    const [p] = await h.db.select().from(period).where(eq(period.id, ids.period));
    expect(p?.workHours).toBe('184.00');
  });

  it('records hours and previews the month in the Current layout', async () => {
    for (const [key, hours] of [
      ['trady', '184'],
      ['ideasoft', '184'],
      ['sklyarov', '5'],
    ] as const) {
      expect(
        (
          await setHours.run(h.ctxFor(finance), {
            periodId: ids.period,
            assignmentId: ids.assignments[key],
            hours,
          })
        ).isOk(),
      ).toBe(true);
    }
    const overview = (
      await getPeriodOverview.run(h.ctxFor(finance), { periodId: ids.period })
    )._unsafeUnwrap();
    // The shared DB may hold other active assignments; sum only this test's rows.
    const mine = new Set(Object.values(ids.assignments));
    const rows = overview.preview.rows.filter((r) => mine.has(r.assignmentId));
    const total = (pick: (r: (typeof rows)[number]) => string | null) =>
      sum(rows.map((r) => pick(r) ?? '0')).toFixed(2);
    expect(total((r) => r.invoiceAmount)).toBe('14373.00');
    expect(total((r) => r.payUsd)).toBe('10220.00');
    expect(total((r) => r.payUahApprox)).toBe('454585.60');
  });

  it('step 4: an adjustment adds to the UAH preview of its item', async () => {
    const ceo = ids.people[3] ?? '';
    const res = await addAdjustment.run(h.ctxFor(finance), {
      periodId: ids.period,
      personId: ceo,
      kind: 'bonus',
      amount: '3325',
      currency: 'UAH',
      reason: 'legacy correction',
    });
    expect(res.isOk()).toBe(true);
    const overview = (
      await getPeriodOverview.run(h.ctxFor(finance), { periodId: ids.period })
    )._unsafeUnwrap();
    const mine = overview.plan.filter((i) => ids.people.includes(i.personId));
    expect(sum(mine.map((i) => i.totalUsd)).toFixed(2)).toBe('10220.00');
    expect(sum(mine.map((i) => i.totalUahApprox ?? '0')).toFixed(2)).toBe('457910.60');
    expect(mine.find((i) => i.personId === ceo)?.totalUahApprox).toBe('93174.60');
  });

  it('closing creates one draft invoice per contract with 5.1 lines', async () => {
    const res = await closePeriod.run(h.ctxFor(finance), { periodId: ids.period });
    expect(res._unsafeUnwrap().draftInvoices).toBe(3);
    const invoices = await h.db.select().from(invoice).where(eq(invoice.periodId, ids.period));
    expect(invoices.map((i) => i.total).sort()).toEqual([
      '225.00000000',
      '5500.00000000',
      '8648.00000000',
    ]);
    expect(
      invoices.every(
        (i) => i.status === 'draft' && i.issueDate === '2037-08-03' && i.dueDate === '2037-08-20',
      ),
    ).toBe(true);
    const lines = await h.db
      .select()
      .from(invoiceLine)
      .where(
        inArray(
          invoiceLine.invoiceId,
          invoices.map((i) => i.id),
        ),
      );
    const trady = lines.find((l) => l.amount === '5500.00000000');
    expect(trady).toMatchObject({ quantity: '1.00', unitPrice: '5500.00000000' });
    expect(lines.every((l) => l.timesheetId !== null)).toBe(true);
  });

  it('closing creates payroll: client work waits for the invoice, internal work is payable', async () => {
    const items = await h.db
      .select()
      .from(payrollItem)
      .where(and(eq(payrollItem.periodId, ids.period), inArray(payrollItem.personId, ids.people)));
    expect(items).toHaveLength(4);
    const lines = await h.db
      .select()
      .from(payrollLine)
      .where(
        inArray(
          payrollLine.payrollItemId,
          items.map((i) => i.id),
        ),
      );
    const byAssignment = (key: string) =>
      lines.find((l) => l.assignmentId === ids.assignments[key]);
    expect(byAssignment('ceo')).toMatchObject({ status: 'payable', fundingSource: 'company' });
    expect(byAssignment('ideasoft')).toMatchObject({
      status: 'awaiting_client',
      amountUsd: '3000.00000000',
    });
    expect(byAssignment('ideasoft')?.fundedByInvoiceLineId).not.toBeNull();
    expect(items.find((i) => i.personId === ids.people[3])?.status).toBe('payable');
    const adj = await addAdjustment.run(h.ctxFor(finance), {
      periodId: ids.period,
      personId: ids.people[3] ?? '',
      kind: 'bonus',
      amount: '1',
      currency: 'USD',
      reason: 'late',
    });
    expect(adj._unsafeUnwrapErr().code).toBe('closed_period');
  });

  it('I6: hours of a closed period cannot change', async () => {
    const res = await setHours.run(h.ctxFor(finance), {
      periodId: ids.period,
      assignmentId: ids.assignments.trady,
      hours: '100',
    });
    expect(res._unsafeUnwrapErr().code).toBe('closed_period');
  });

  it('only the owner reopens, with a reason; re-closing regenerates drafts', async () => {
    const byFinance = await reopenPeriod.run(h.ctxFor(finance), {
      periodId: ids.period,
      reason: 'fix hours',
    });
    expect(byFinance._unsafeUnwrapErr().code).toBe('forbidden');
    expect(
      (
        await reopenPeriod.run(h.ctxFor(owner), { periodId: ids.period, reason: 'fix hours' })
      ).isOk(),
    ).toBe(true);
    await setHours.run(h.ctxFor(finance), {
      periodId: ids.period,
      assignmentId: ids.assignments.sklyarov,
      hours: '10',
    });
    await closePeriod.run(h.ctxFor(finance), { periodId: ids.period });
    const invoices = await h.db.select().from(invoice).where(eq(invoice.periodId, ids.period));
    expect(invoices).toHaveLength(3);
    expect(invoices.map((i) => i.total)).toContain('450.00000000');
    const items = await h.db
      .select()
      .from(payrollItem)
      .where(and(eq(payrollItem.periodId, ids.period), inArray(payrollItem.personId, ids.people)));
    expect(items).toHaveLength(4);
  });
});
