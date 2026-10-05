import type { DbTransaction } from '@tally/db';
import {
  agencyTerms,
  assignment,
  billingTerms,
  client,
  contract,
  payee,
  payTerms,
  period,
  person,
  timesheet,
  type AgencyTerms,
  type BillingTerms,
  type PayTerms,
} from '@tally/db/schema';
import {
  effectiveVersion,
  marginByTerms,
  startOfMonth,
  weekdayHoursInMonth,
  type LocalDate,
} from '@tally/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import {
  addAgencyVersionInput,
  addBillingVersionInput,
  addPayVersionInput,
  createAssignmentInput,
  updateAssignmentInput,
} from './schema';

type Versioned<T> = T & { validFrom: LocalDate };

export type TermsMarginView = {
  month: LocalDate;
  workHours: number;
  billing: string;
  pay: string;
  agency: string;
  margin: string;
  currency: string;
} | null;

/** "Margin by terms" for the month of `today` (assumptions A-015). */
export function assignmentMargin(
  billing: BillingTerms[],
  pay: PayTerms[],
  today: LocalDate,
  agency: AgencyTerms[] = [],
): TermsMarginView {
  const month = startOfMonth(today);
  const b = effectiveVersion(billing as Versioned<BillingTerms>[], month);
  const p = effectiveVersion(pay as Versioned<PayTerms>[], month);
  const fee = effectiveVersion(agency as Versioned<AgencyTerms>[], month);
  if (!b && !p) return null;
  const workHours = weekdayHoursInMonth(month);
  const margin = marginByTerms(
    b && { type: b.type, rate: b.rate, prorationPolicy: b.prorationPolicy, currency: b.currency },
    p && { type: p.type, amount: p.amount, currency: p.currency },
    String(workHours),
    fee?.ratePerHour ?? '0',
  );
  if (!margin) return null;
  return {
    month,
    workHours,
    billing: margin.billing.toFixed(2),
    pay: margin.pay.toFixed(2),
    agency: margin.agency.toFixed(2),
    margin: margin.margin.toFixed(2),
    currency: b?.currency ?? p?.currency ?? 'USD',
  };
}

const clientLabel = sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`;
const payeeName = sql<string | null>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;

async function loadTerms(tx: DbTransaction, assignmentIds: string[]) {
  if (assignmentIds.length === 0) return { billing: [], pay: [], agency: [] };
  const [billing, pay, agency] = await Promise.all([
    tx
      .select()
      .from(billingTerms)
      .where(inArray(billingTerms.assignmentId, assignmentIds))
      .orderBy(desc(billingTerms.validFrom)),
    tx
      .select()
      .from(payTerms)
      .where(inArray(payTerms.assignmentId, assignmentIds))
      .orderBy(desc(payTerms.validFrom)),
    tx.select().from(agencyTerms).where(inArray(agencyTerms.assignmentId, assignmentIds)),
  ]);
  return { billing, pay, agency };
}

const assignmentSelect = {
  assignment,
  personName: person.fullName,
  contractNumber: contract.number,
  clientId: client.id,
  clientName: clientLabel,
};

/** Assignments of a person with current terms and margin (finance+, RLS). */
export const listPersonAssignments = defineService({
  name: 'assignments.forPerson',
  input: z.object({ personId: z.uuid() }),
  handler: async (ctx, { personId }) => {
    const rows = await inActorScope(ctx, async (tx) => {
      const list = await tx
        .select(assignmentSelect)
        .from(assignment)
        .innerJoin(person, eq(person.id, assignment.personId))
        .leftJoin(contract, eq(contract.id, assignment.contractId))
        .leftJoin(client, eq(client.id, contract.clientId))
        .where(eq(assignment.personId, personId))
        .orderBy(desc(assignment.startsOn));
      const terms = await loadTerms(
        tx,
        list.map((r) => r.assignment.id),
      );
      return list.map((r) => {
        const billing = terms.billing.filter((t) => t.assignmentId === r.assignment.id);
        const pay = terms.pay.filter((t) => t.assignmentId === r.assignment.id);
        const agency = terms.agency.filter((t) => t.assignmentId === r.assignment.id);
        return { ...r, margin: assignmentMargin(billing, pay, ctx.today, agency) };
      });
    });
    return ok(rows);
  },
});

export const getAssignment = defineService({
  name: 'assignments.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const card = await inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select(assignmentSelect)
        .from(assignment)
        .innerJoin(person, eq(person.id, assignment.personId))
        .leftJoin(contract, eq(contract.id, assignment.contractId))
        .leftJoin(client, eq(client.id, contract.clientId))
        .where(eq(assignment.id, id));
      if (!row) return null;
      const { billing, pay, agency: agencyVersions } = await loadTerms(tx, [id]);
      const agency = await tx
        .select({ terms: agencyTerms, payeeName })
        .from(agencyTerms)
        .innerJoin(payee, eq(payee.id, agencyTerms.payeeId))
        .where(eq(agencyTerms.assignmentId, id))
        .orderBy(desc(agencyTerms.validFrom));
      const hours = await tx
        .select({
          month: period.month,
          hours: timesheet.hours,
          workHours: period.workHours,
          source: timesheet.source,
        })
        .from(timesheet)
        .innerJoin(period, eq(period.id, timesheet.periodId))
        .where(eq(timesheet.assignmentId, id))
        .orderBy(desc(period.month));
      return {
        ...row,
        billing,
        pay,
        agency,
        hours,
        margin: assignmentMargin(billing, pay, ctx.today, agencyVersions),
      };
    });
    return card ? ok(card) : err(serviceError('not_found', 'assignments.notFound'));
  },
});

/** Active client contracts for the assignment form. */
export const contractOptions = defineService({
  name: 'assignments.contractOptions',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({ id: contract.id, number: contract.number, clientName: clientLabel })
        .from(contract)
        .innerJoin(client, eq(client.id, contract.clientId))
        .where(and(eq(contract.kind, 'client'), eq(contract.status, 'active')))
        .orderBy(asc(clientLabel), asc(contract.number)),
    );
    return ok(rows.map((r) => ({ value: r.id, label: `${r.clientName ?? ''} · ${r.number}` })));
  },
});

/**
 * New assignment with the first versions of both term blocks (spec 6.3). Versions start on the
 * first day of the start month, since terms change only at month boundaries (A-018).
 */
export const createAssignment = defineService({
  name: 'assignments.create',
  input: createAssignmentInput,
  handler: async (ctx, { billing, pay, ...core }) => {
    const validFrom = startOfMonth(core.startsOn);
    const created = await inActorScope(ctx, async (tx) => {
      const [row] = await tx.insert(assignment).values(core).returning({ id: assignment.id });
      if (!row) throw new Error('Assignment insert returned no row');
      await tx.insert(billingTerms).values({ ...billing, assignmentId: row.id, validFrom });
      await tx.insert(payTerms).values({ ...pay, assignmentId: row.id, validFrom });
      return row;
    });
    return ok(created);
  },
});

export const updateAssignment = defineService({
  name: 'assignments.update',
  input: updateAssignmentInput,
  handler: async (ctx, { id, ...core }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.update(assignment).set(core).where(eq(assignment.id, id)).returning({ id: assignment.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'assignments.notFound'));
  },
});

/** A change of client terms is always a new version; closed periods are guarded by I10. */
export const addBillingVersion = defineService({
  name: 'assignments.addBillingVersion',
  input: addBillingVersionInput,
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.insert(billingTerms).values(input).returning({ id: billingTerms.id }),
    );
    return row
      ? ok({ id: input.assignmentId })
      : err(serviceError('internal_error', 'general.saveFailed'));
  },
});

export const addPayVersion = defineService({
  name: 'assignments.addPayVersion',
  input: addPayVersionInput,
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.insert(payTerms).values(input).returning({ id: payTerms.id }),
    );
    return row
      ? ok({ id: input.assignmentId })
      : err(serviceError('internal_error', 'general.saveFailed'));
  },
});

/** A new agency fee version (A-068); closed periods are guarded by I10 like the other terms. */
export const addAgencyVersion = defineService({
  name: 'assignments.addAgencyVersion',
  input: addAgencyVersionInput,
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.insert(agencyTerms).values(input).returning({ id: agencyTerms.id }),
    );
    return row
      ? ok({ id: input.assignmentId })
      : err(serviceError('internal_error', 'general.saveFailed'));
  },
});

/** Payees an agency fee can go to: FOPs and other legal recipients, not crypto wallets. */
export const agencyPayeeOptions = defineService({
  name: 'assignments.agencyPayeeOptions',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({ id: payee.id, name: payeeName })
        .from(payee)
        .where(inArray(payee.kind, ['fop', 'other']))
        .orderBy(asc(payeeName)),
    );
    return ok(rows.map((r) => ({ value: r.id, label: r.name ?? '' })));
  },
});
