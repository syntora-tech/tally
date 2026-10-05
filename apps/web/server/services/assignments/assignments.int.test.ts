import {
  assignment,
  billingTerms,
  client,
  company,
  contract,
  payTerms,
  period,
  person,
} from '@tally/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import {
  addBillingVersion,
  addPayVersion,
  createAssignment,
  getAssignment,
  listPersonAssignments,
} from '.';

// "Today" is in July 2026 so margin uses the July norm of 184 hours (spec 9.2).
const h = intHarness('2026-07-15');
let owner: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
const ids = { company: '', client: '', contract: '', person: '', periods: [] as string[] };
const assignmentIds: string[] = [];

beforeAll(async () => {
  owner = await h.user('owner');
  viewer = await h.user('viewer');
  const [co] = await h.db.insert(company).values({ nameEn: 'S', nameUa: 'С' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Trady' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'client',
      number: 'Trady SOW',
      companyId: co?.id ?? '',
      clientId: cl?.id ?? '',
    })
    .returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Vladyslav' }).returning();
  ids.company = co?.id ?? '';
  ids.client = cl?.id ?? '';
  ids.contract = ct?.id ?? '';
  ids.person = p?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (ids.periods.length) await db.delete(period).where(inArray(period.id, ids.periods));
    if (assignmentIds.length) {
      await db.delete(billingTerms).where(inArray(billingTerms.assignmentId, assignmentIds));
      await db.delete(payTerms).where(inArray(payTerms.assignmentId, assignmentIds));
      await db.delete(assignment).where(inArray(assignment.id, assignmentIds));
    }
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('assignments with two-sided terms (spec 6.3)', () => {
  it('creates the assignment and first versions from the start month', async () => {
    const res = await createAssignment.run(h.ctxFor(owner), {
      personId: ids.person,
      contractId: ids.contract,
      roleTitle: 'Senior Backend Developer',
      fte: '1',
      startsOn: '2026-01-12',
      billing: { type: 'fixed_monthly', rate: '5500', prorationPolicy: 'full_month' },
      pay: { type: 'fixed', amount: '5000', payoutMethod: 'crypto' },
    });
    const { id } = res._unsafeUnwrap();
    assignmentIds.push(id);
    const card = (await getAssignment.run(h.ctxFor(owner), { id }))._unsafeUnwrap();
    expect(card.billing.map((b) => b.validFrom)).toEqual(['2026-01-01']);
    expect(card.pay[0]).toMatchObject({
      validFrom: '2026-01-01',
      amount: '5000.00000000',
      payoutMethod: 'crypto',
    });
  });

  it('AC 6.3: shows margin by terms — Trady 5 500 − 5 000 = 500 for July (H = 184)', async () => {
    const [row] = (
      await listPersonAssignments.run(h.ctxFor(owner), { personId: ids.person })
    )._unsafeUnwrap();
    expect(row?.margin).toEqual({
      month: '2026-07-01',
      workHours: 184,
      billing: '5500.00',
      pay: '5000.00',
      agency: '0.00',
      margin: '500.00',
      currency: 'USD',
    });
  });

  it('adds versions from an open month and uses them for margin', async () => {
    const id = assignmentIds[0] ?? '';
    const res = await addPayVersion.run(h.ctxFor(owner), {
      assignmentId: id,
      validFrom: '2026-07',
      type: 'fixed',
      amount: '5200',
    });
    expect(res.isOk()).toBe(true);
    const card = (await getAssignment.run(h.ctxFor(owner), { id }))._unsafeUnwrap();
    expect(card.margin?.margin).toBe('300.00');
  });

  it('AC 6.3: back-dated change into a closed period is rejected with a readable message', async () => {
    const inserted = await h.db
      .insert(period)
      .values([
        { month: '2026-05-01', workHours: '160', status: 'closed' },
        { month: '2026-06-01', workHours: '176', status: 'closed' },
      ])
      .returning({ id: period.id });
    ids.periods.push(...inserted.map((p) => p.id));

    const res = await addBillingVersion.run(h.ctxFor(owner), {
      assignmentId: assignmentIds[0],
      validFrom: '2026-06-01',
      type: 'fixed_monthly',
      rate: '6000',
    });
    const error = res._unsafeUnwrapErr();
    expect(error.code).toBe('closed_period');
    expect(error.message).toContain('01.07.2026');
    const card = (
      await getAssignment.run(h.ctxFor(owner), { id: assignmentIds[0] ?? '' })
    )._unsafeUnwrap();
    expect(card.billing).toHaveLength(1);
  });

  it('rejects a second version for the same month', async () => {
    const res = await addPayVersion.run(h.ctxFor(owner), {
      assignmentId: assignmentIds[0],
      validFrom: '2026-07-01',
      type: 'fixed',
      amount: '5300',
    });
    expect(res._unsafeUnwrapErr().message).toBe('db.versionExists');
  });

  it('accepts internal assignments without a contract and billing none', async () => {
    const res = await createAssignment.run(h.ctxFor(owner), {
      personId: ids.person,
      isInternal: 'on',
      roleTitle: 'CTO',
      // May and June are closed by the previous test, so a January start would hit I10.
      startsOn: '2026-07-01',
      billing: { type: 'none' },
      pay: { type: 'fixed', amount: '2020' },
    });
    const { id } = res._unsafeUnwrap();
    assignmentIds.push(id);
    const card = (await getAssignment.run(h.ctxFor(owner), { id }))._unsafeUnwrap();
    expect(card.margin?.margin).toBe('-2020.00');
  });

  it('validates contract, FTE and month-start dates', async () => {
    const res = await createAssignment.run(h.ctxFor(owner), {
      personId: ids.person,
      fte: '1.5',
      startsOn: '2026-01-01',
      billing: { type: 'hourly', rate: '47' },
      pay: { type: 'fixed', amount: '3000' },
    });
    expect(Object.keys(res._unsafeUnwrapErr().fieldErrors ?? {}).sort()).toEqual([
      'contractId',
      'fte',
    ]);
    const mid = await addBillingVersion.run(h.ctxFor(owner), {
      assignmentId: assignmentIds[0],
      validFrom: '2026-08-15',
      type: 'hourly',
      rate: '47',
    });
    expect(mid._unsafeUnwrapErr().fieldErrors?.validFrom?.[0]).toBe('field.monthStart');
  });

  it('viewer sees no assignments or terms', async () => {
    expect(
      (await listPersonAssignments.run(h.ctxFor(viewer), { personId: ids.person }))._unsafeUnwrap(),
    ).toEqual([]);
  });
});
