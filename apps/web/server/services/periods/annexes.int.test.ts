import {
  assignment,
  billingTerms,
  client,
  company,
  contract,
  contractAnnex,
  invoice,
  invoiceLine,
  payrollItem,
  payTerms,
  period,
  person,
  timesheet,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { closePeriod, openPeriod, setHours } from '.';

// September 2039: invoices fall on Monday 03.10.2039, far from real periods in the shared DB.
const h = intHarness('2039-10-03');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  client: '',
  contracts: [] as string[],
  annexes: {} as Record<'ruled' | 'plain' | 'foreign', string>,
  people: [] as string[],
  assignments: {} as Record<'ruled' | 'plain' | 'none', string>,
  period: '',
};

async function makeAssignment(key: 'ruled' | 'plain' | 'none', annexId: string | null) {
  const [p] = await h.db
    .insert(person)
    .values({ fullName: `Annex ${key}` })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({
      personId: p?.id ?? '',
      contractId: ids.contracts[0],
      annexId,
      startsOn: '2039-01-01',
    })
    .returning();
  const assignmentId = a?.id ?? '';
  await h.db
    .insert(billingTerms)
    .values({ assignmentId, validFrom: '2039-01-01', type: 'hourly', rate: '10' });
  await h.db
    .insert(payTerms)
    .values({ assignmentId, validFrom: '2039-01-01', type: 'hourly', amount: '1000' });
  ids.people.push(p?.id ?? '');
  ids.assignments[key] = assignmentId;
}

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'A', nameUa: 'А' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Annex Client' }).returning();
  ids.company = co?.id ?? '';
  ids.client = cl?.id ?? '';
  for (const number of ['Annex MSA', 'Other MSA']) {
    const [ct] = await h.db
      .insert(contract)
      .values({ kind: 'client', number, companyId: ids.company, clientId: ids.client })
      .returning();
    ids.contracts.push(ct?.id ?? '');
  }
  const annex = async (contractId: string | undefined, number: string, ruled: boolean) => {
    const [row] = await h.db
      .insert(contractAnnex)
      .values({
        contractId: contractId ?? '',
        kind: 'sow',
        number,
        ...(ruled ? { paymentDueRule: { type: 'net_working_days', days: 15 } } : {}),
      })
      .returning();
    return row?.id ?? '';
  };
  ids.annexes = {
    ruled: await annex(ids.contracts[0], '1', true),
    plain: await annex(ids.contracts[0], '2', false),
    foreign: await annex(ids.contracts[1], '1', false),
  };
  await makeAssignment('ruled', ids.annexes.ruled);
  await makeAssignment('plain', ids.annexes.plain);
  await makeAssignment('none', null);
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (ids.period) {
      // Other tests' open-ended assignments get invoiced in this month too; drop them all.
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
    await db.delete(assignment).where(inArray(assignment.id, Object.values(ids.assignments)));
    await db.delete(person).where(inArray(person.id, ids.people));
    await db.delete(contractAnnex).where(inArray(contractAnnex.id, Object.values(ids.annexes)));
    await db.delete(contract).where(inArray(contract.id, ids.contracts));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('SOW/annex date rules (A-072)', () => {
  it('an assignment may only name a SOW of its own contract (TL062)', async () => {
    await expect(
      h.db
        .update(assignment)
        .set({ annexId: ids.annexes.foreign })
        .where(eq(assignment.id, ids.assignments.none)),
    ).rejects.toMatchObject({ cause: { code: 'TL062' } });
  });

  it('a SOW with its own payment rule gets its own invoice at period close', async () => {
    const opened = await openPeriod.run(h.ctxFor(finance), { month: '2039-09' });
    ids.period = opened._unsafeUnwrap().id;
    for (const assignmentId of Object.values(ids.assignments)) {
      await setHours.run(h.ctxFor(finance), { periodId: ids.period, assignmentId, hours: '10' });
    }
    expect((await closePeriod.run(h.ctxFor(finance), { periodId: ids.period })).isOk()).toBe(true);

    const invoices = await h.db
      .select()
      .from(invoice)
      .where(eq(invoice.contractId, ids.contracts[0] ?? ''));
    const byAnnex = new Map(invoices.map((i) => [i.annexId, i]));
    expect(invoices).toHaveLength(2);
    // Mon 03.10.2039 + 15 working days.
    expect(byAnnex.get(ids.annexes.ruled)).toMatchObject({
      issueDate: '2039-10-03',
      dueDate: '2039-10-24',
      total: '100.00000000',
    });
    // The SOW without rules of its own shares the contract's invoice.
    expect(byAnnex.get(null)).toMatchObject({ dueDate: '2039-10-20', total: '200.00000000' });
  });
});
