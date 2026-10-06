import type { DbTransaction } from '@tally/db';
import {
  agencyTerms,
  assignment,
  billingTerms,
  client,
  contract,
  contractAnnex,
  payTerms,
  person,
} from '@tally/db/schema';
import {
  addDays,
  compareLocalDate,
  effectiveVersion,
  startOfMonth,
  toDecimal,
  type LocalDate,
} from '@tally/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { localDateString, monthStart } from '../fields';
import { definedOnly } from '../patch';
import { assignmentCoreShape, billingTermsFields, payTermsFields } from './schema';

const clientLabel = sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`;

async function loadAssignments(tx: DbTransaction, where: SQL | undefined) {
  const rows = await tx
    .select({
      assignment,
      personName: person.fullName,
      contractNumber: contract.number,
      clientId: contract.clientId,
      clientName: clientLabel,
      annexKind: contractAnnex.kind,
      annexNumber: contractAnnex.number,
    })
    .from(assignment)
    .innerJoin(person, eq(person.id, assignment.personId))
    .leftJoin(contract, eq(contract.id, assignment.contractId))
    .leftJoin(client, eq(client.id, contract.clientId))
    .leftJoin(contractAnnex, eq(contractAnnex.id, assignment.annexId))
    .where(where)
    .orderBy(asc(person.fullName), desc(assignment.startsOn));
  const ids = rows.map((r) => r.assignment.id);
  const [billing, pay, agency] = ids.length
    ? await Promise.all([
        tx.select().from(billingTerms).where(inArray(billingTerms.assignmentId, ids)),
        tx.select().from(payTerms).where(inArray(payTerms.assignmentId, ids)),
        tx.select().from(agencyTerms).where(inArray(agencyTerms.assignmentId, ids)),
      ])
    : [[], [], []];
  const byAssignment = <T extends { assignmentId: string; validFrom: string }>(
    list: T[],
    id: string,
  ) =>
    list
      .filter((v) => v.assignmentId === id)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
      .map((v) => ({ ...v, validFrom: v.validFrom as LocalDate }));
  return rows.map((r) => ({
    ...r,
    billing: byAssignment(billing, r.assignment.id),
    pay: byAssignment(pay, r.assignment.id),
    agency: byAssignment(agency, r.assignment.id),
  }));
}

export type AgentAssignmentRow = Awaited<ReturnType<typeof loadAssignments>>[number] & {
  month: LocalDate;
};

/** Assignments with every terms version and the ones in force in a month (A-073). */
export const listAssignments = defineService({
  name: 'assignments.listForAgent',
  input: z.object({
    personId: z.uuid().optional(),
    contractId: z.uuid().optional(),
    annexId: z.uuid().optional(),
    clientId: z.uuid().optional(),
    activeOn: localDateString
      .optional()
      .describe('Only assignments running on this date; also picks the terms in force'),
  }),
  handler: async (ctx, input) => {
    const on = input.activeOn ?? ctx.today;
    const filters = [
      input.personId ? eq(assignment.personId, input.personId) : undefined,
      input.contractId ? eq(assignment.contractId, input.contractId) : undefined,
      input.annexId ? eq(assignment.annexId, input.annexId) : undefined,
      input.clientId ? eq(contract.clientId, input.clientId) : undefined,
      input.activeOn
        ? and(
            lte(assignment.startsOn, input.activeOn),
            or(isNull(assignment.endsOn), gte(assignment.endsOn, input.activeOn)),
          )
        : undefined,
    ];
    const rows = await inActorScope(ctx, (tx) => loadAssignments(tx, and(...filters)));
    return ok(rows.map((r) => ({ ...r, month: startOfMonth(on) })));
  },
});

export function currentTerms(r: AgentAssignmentRow) {
  return {
    billing: effectiveVersion(r.billing, r.month),
    pay: effectiveVersion(r.pay, r.month),
    agency: effectiveVersion(r.agency, r.month),
  };
}

const billingVersion = billingTermsFields.extend({
  validFrom: monthStart
    .optional()
    .describe(
      'First day of the month the version starts; default: the start month, or the first open month',
    ),
});
const payVersion = payTermsFields.extend({ validFrom: billingVersion.shape.validFrom });

const core = z.object(assignmentCoreShape);
const assignmentItem = core.partial().extend({
  id: z
    .uuid()
    .optional()
    .describe('Assignment id; without it matched by person + contract + SOW + start'),
  personId: z.uuid().optional(),
  contractId: z.uuid().nullable().optional(),
  annexId: z
    .uuid()
    .nullable()
    .optional()
    .describe('SOW/annex of the same contract (list_contract_annexes); null = the contract'),
  isInternal: z
    .boolean()
    .optional()
    .describe('CEO/CTO on our own company: no contract, no billing'),
  billing: billingVersion.optional(),
  pay: payVersion.optional(),
});

type Problems = Record<string, string[]>;
type VersionStatus = 'added' | 'existing' | null;

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

const MONEY_FIELDS = new Set(['rate', 'amount']);

/** The sent version repeats the stored one: money compared as decimals, the rest as is. */
function sameVersion(stored: Record<string, unknown>, sent: Record<string, unknown>) {
  return Object.entries(sent).every(([k, v]) =>
    MONEY_FIELDS.has(k) ? toDecimal(String(stored[k])).eq(toDecimal(String(v))) : stored[k] === v,
  );
}

/**
 * Assignments in bulk with their first or next terms versions (A-073). Person, contract and the
 * internal flag are fixed once created; a SOW, role, FTE and dates can change. A terms version
 * is never edited: the same month with other values is an error, a later month adds a version.
 */
export const upsertAssignments = defineService({
  name: 'assignments.upsertBatch',
  input: z.object({
    assignments: z.array(assignmentItem).min(1).max(100),
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const [closed] = await tx.execute<{ end: string | null }>(
        sql`select public.last_closed_period_end()::text as end`,
      );
      const closedEnd = (closed?.end ?? null) as LocalDate | null;
      const firstOpen = closedEnd ? addDays(closedEnd, 1) : null;
      const errors: Problems = {};
      const results = [];

      for (const [index, item] of input.assignments.entries()) {
        const key = `assignments.${String(index)}`;
        const { id, billing, pay, personId, contractId, annexId, isInternal, ...patch } = item;
        const problems: string[] = [];

        let current: typeof assignment.$inferSelect | undefined;
        if (id) {
          [current] = await tx.select().from(assignment).where(eq(assignment.id, id));
          if (!current) {
            errors[key] = ['assignments.notFound'];
            continue;
          }
        } else if (personId && patch.startsOn) {
          [current] = await tx
            .select()
            .from(assignment)
            .where(
              and(
                eq(assignment.personId, personId),
                contractId ? eq(assignment.contractId, contractId) : isNull(assignment.contractId),
                annexId ? eq(assignment.annexId, annexId) : isNull(assignment.annexId),
                eq(assignment.startsOn, patch.startsOn),
              ),
            );
        }

        if (current) {
          if (
            (personId && personId !== current.personId) ||
            (contractId !== undefined && contractId !== current.contractId) ||
            (isInternal !== undefined && isInternal !== current.isInternal)
          ) {
            errors[key] = ['assignments.fixedLink'];
            continue;
          }
        } else {
          if (!personId || !patch.startsOn) {
            errors[key] = ['assignments.newNeedsPerson'];
            continue;
          }
          if (!isInternal && !contractId) problems.push('assignments.contractOrInternal');
          if (isInternal && (contractId || annexId))
            problems.push('assignments.internalNoContract');
          if (!billing || !pay) problems.push('assignments.newNeedsTerms');
        }

        const contractOf = current?.contractId ?? contractId ?? null;
        if (annexId) {
          const [annex] = await tx
            .select({ contractId: contractAnnex.contractId })
            .from(contractAnnex)
            .where(eq(contractAnnex.id, annexId));
          if (!annex) problems.push('contracts.annexNotFound');
          else if (annex.contractId !== contractOf) problems.push('db.annexContract');
        }
        if (contractId && !current) {
          const [c] = await tx
            .select({ kind: contract.kind })
            .from(contract)
            .where(eq(contract.id, contractId));
          if (!c) problems.push('contracts.notFound');
          else if (c.kind !== 'client') problems.push('assignments.clientContract');
        }

        const merged = core.safeParse({ ...current, ...definedOnly(patch) });
        if (!merged.success) problems.push(...issues(merged.error));
        else if (merged.data.endsOn && merged.data.endsOn < merged.data.startsOn) {
          problems.push('assignments.endBeforeStart');
        }
        if (problems.length || !merged.success) {
          errors[key] = problems;
          continue;
        }

        let assignmentId: string;
        let status: 'created' | 'updated' | 'unchanged';
        if (current) {
          const values = definedOnly({ ...patch, ...(annexId !== undefined ? { annexId } : {}) });
          const stored = current as Record<string, unknown>;
          const changed = Object.entries(values).some(([k, v]) =>
            k === 'fte' ? !toDecimal(String(stored[k])).eq(toDecimal(String(v))) : stored[k] !== v,
          );
          if (changed) await tx.update(assignment).set(values).where(eq(assignment.id, current.id));
          assignmentId = current.id;
          status = changed ? 'updated' : 'unchanged';
        } else {
          const [row] = await tx
            .insert(assignment)
            .values({
              ...merged.data,
              personId: personId ?? '',
              contractId: isInternal ? null : (contractId ?? null),
              annexId: annexId ?? null,
              isInternal: isInternal ?? false,
            })
            .returning({ id: assignment.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          assignmentId = row.id;
          status = 'created';
        }

        // Versions without a month start with the assignment, but never inside a closed month (I10),
        // so re-sending the item that created an assignment finds its first versions again.
        const startMonth = startOfMonth(merged.data.startsOn);
        const defaultFrom =
          firstOpen && compareLocalDate(firstOpen, startMonth) > 0 ? firstOpen : startMonth;
        const addVersion = async (
          table: typeof billingTerms | typeof payTerms,
          label: 'billing' | 'pay',
          version: z.output<typeof billingVersion> | z.output<typeof payVersion> | undefined,
        ): Promise<VersionStatus> => {
          if (!version) return null;
          const { validFrom: sentFrom, ...fields } = version;
          const validFrom = sentFrom ?? defaultFrom;
          if (closedEnd && compareLocalDate(validFrom, closedEnd) <= 0) {
            problems.push(
              msg('assignments.versionClosed', { terms: label, month: firstOpen ?? validFrom }),
            );
            return null;
          }
          const [existing] = await tx
            .select()
            .from(table)
            .where(and(eq(table.assignmentId, assignmentId), eq(table.validFrom, validFrom)));
          if (existing) {
            if (sameVersion(existing, fields)) return 'existing';
            problems.push(msg('assignments.versionExists', { terms: label, month: validFrom }));
            return null;
          }
          await tx.insert(table).values({ ...fields, assignmentId, validFrom } as never);
          return 'added';
        };
        const billingStatus = await addVersion(billingTerms, 'billing', billing);
        const payStatus = await addVersion(payTerms, 'pay', pay);
        if (problems.length) {
          errors[key] = problems;
          continue;
        }
        results.push({
          index,
          id: assignmentId,
          status,
          billingVersion: billingStatus,
          payVersion: payStatus,
        });
      }
      if (Object.keys(errors).length) {
        return err(
          serviceError(
            'validation_error',
            msg('batch.failedItems', { count: Object.keys(errors).length }),
            errors,
          ),
        );
      }
      return ok({ results });
    }),
});
