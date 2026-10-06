import type { DbTransaction } from '@tally/db';
import {
  agencyTerms,
  assignment,
  billingTerms,
  client,
  contract,
  contractAnnex,
  invoice,
  invoiceLine,
  payTerms,
  type period,
  person,
  timesheet,
  workCalendarException,
} from '@tally/db/schema';
import {
  defaultInvoiceDate,
  draftLine,
  dueDate,
  isActiveInMonth,
  sum,
  WorkCalendar,
  type InvoiceDateRule,
  type LocalDate,
  type PaymentDueRule,
  type PeriodAssignment,
} from '@tally/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { serviceError, msg } from '../errors';

export async function loadCalendar(tx: DbTransaction): Promise<WorkCalendar> {
  const rows = await tx
    .select({ date: workCalendarException.onDate, isWorking: workCalendarException.isWorking })
    .from(workCalendarException);
  return new WorkCalendar(rows.map((r) => ({ date: r.date as LocalDate, isWorking: r.isWorking })));
}

export const clientLabel = sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`;

export type PeriodRow = typeof period.$inferSelect;

/** Everything the wizard needs for one month: assignments with all term versions and hours. */
export async function loadPeriodData(tx: DbTransaction, p: PeriodRow) {
  const month = p.month as LocalDate;
  const rows = await tx
    .select({
      assignment,
      personName: person.fullName,
      clientName: clientLabel,
    })
    .from(assignment)
    .innerJoin(person, eq(person.id, assignment.personId))
    .leftJoin(contract, eq(contract.id, assignment.contractId))
    .leftJoin(client, eq(client.id, contract.clientId))
    .orderBy(person.fullName);
  const active = rows.filter((r) =>
    isActiveInMonth(
      {
        startsOn: r.assignment.startsOn as LocalDate,
        endsOn: r.assignment.endsOn as LocalDate | null,
      },
      month,
    ),
  );
  const ids = active.map((r) => r.assignment.id);
  const [billing, pay, agency, hours] = ids.length
    ? await Promise.all([
        tx.select().from(billingTerms).where(inArray(billingTerms.assignmentId, ids)),
        tx.select().from(payTerms).where(inArray(payTerms.assignmentId, ids)),
        tx.select().from(agencyTerms).where(inArray(agencyTerms.assignmentId, ids)),
        tx
          .select()
          .from(timesheet)
          .where(and(eq(timesheet.periodId, p.id), inArray(timesheet.assignmentId, ids))),
      ])
    : [[], [], [], []];
  const assignments: PeriodAssignment[] = active.map((r) => ({
    assignmentId: r.assignment.id,
    personId: r.assignment.personId,
    personName: r.personName,
    clientName: r.assignment.isInternal ? null : r.clientName,
    contractId: r.assignment.contractId,
    roleTitle: r.assignment.roleTitle,
    isInternal: r.assignment.isInternal,
    startsOn: r.assignment.startsOn as LocalDate,
    endsOn: r.assignment.endsOn as LocalDate | null,
    billing: billing
      .filter((b) => b.assignmentId === r.assignment.id)
      .map((b) => ({
        type: b.type,
        rate: b.rate,
        prorationPolicy: b.prorationPolicy,
        currency: b.currency,
        validFrom: b.validFrom as LocalDate,
      })),
    pay: pay
      .filter((t) => t.assignmentId === r.assignment.id)
      .map((t) => ({
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        validFrom: t.validFrom as LocalDate,
        payoutMethod: t.payoutMethod,
        releasePolicy: t.releasePolicy,
        graceDays: t.graceDays,
      })),
    agency: agency
      .filter((t) => t.assignmentId === r.assignment.id)
      .map((t) => ({
        validFrom: t.validFrom as LocalDate,
        payeeId: t.payeeId,
        ratePerHour: t.ratePerHour,
        payoutMethod: t.payoutMethod,
        releasePolicy: t.releasePolicy,
        graceDays: t.graceDays,
      })),
    hours: hours.find((h) => h.assignmentId === r.assignment.id)?.hours ?? null,
    payHours: hours.find((h) => h.assignmentId === r.assignment.id)?.payHours ?? null,
    note: hours.find((h) => h.assignmentId === r.assignment.id)?.note ?? null,
  }));
  const timesheetIds = new Map(hours.map((h) => [h.assignmentId, h.id]));
  const annexIds = new Map(active.map((r) => [r.assignment.id, r.assignment.annexId]));
  return { month, assignments, timesheetIds, annexIds };
}

function describe(personName: string, roleTitle: string | null) {
  const role = roleTitle ? `, ${roleTitle}` : '';
  return {
    descriptionEn: `Software development services — ${personName}${role}`,
    descriptionUa: `Послуги з розробки програмного забезпечення — ${personName}${role}`,
  };
}

export const invoiceKey = (contractId: string, annexId: string | null) =>
  `${contractId}:${annexId ?? ''}`;

export type InvoiceGroup = {
  key: string;
  contractId: string;
  annexId: string | null;
  lines: {
    a: PeriodAssignment;
    line: NonNullable<ReturnType<typeof draftLine>>;
    currency: string;
  }[];
};

/**
 * Invoice lines of a month grouped by invoice: one per contract, and one per SOW/annex whose date
 * rules replace the contract's (A-072). Assignments without billable hours give no line.
 */
export async function invoiceGroups(
  tx: DbTransaction,
  month: LocalDate,
  workHours: string,
  assignments: readonly PeriodAssignment[],
  annexIds: Map<string, string | null>,
) {
  const annexIdList = [...new Set([...annexIds.values()].filter((id) => id !== null))];
  const annexes = new Map(
    (annexIdList.length
      ? await tx.select().from(contractAnnex).where(inArray(contractAnnex.id, annexIdList))
      : []
    )
      .filter((x) => x.paymentDueRule !== null || x.invoiceDateRule !== null)
      .map((x) => [x.id, x]),
  );
  const groups = new Map<string, InvoiceGroup>();
  for (const a of assignments) {
    const b = a.billing
      .filter((v) => v.validFrom <= month)
      .sort((x, y) => y.validFrom.localeCompare(x.validFrom))[0];
    if (!b || !a.contractId) continue;
    const ownAnnex = annexIds.get(a.assignmentId);
    const annexId = ownAnnex && annexes.has(ownAnnex) ? ownAnnex : null;
    const key = invoiceKey(a.contractId, annexId);
    const line = draftLine(a.assignmentId, b, a.hours ?? '0', workHours);
    if (!line) continue;
    const group = groups.get(key) ?? { key, contractId: a.contractId, annexId, lines: [] };
    group.lines.push({ a, line, currency: b.currency });
    groups.set(key, group);
  }
  return { groups, annexes };
}

/** One draft invoice of a group (5.1); null when the contract has no client. */
export async function writeDraftInvoice(
  tx: DbTransaction,
  input: {
    periodId: string;
    month: LocalDate;
    cal: WorkCalendar;
    group: InvoiceGroup;
    annexes: Map<string, typeof contractAnnex.$inferSelect>;
    timesheetIds: Map<string, string>;
  },
) {
  const { contractId, annexId, lines } = input.group;
  const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
  if (!c?.clientId) return ok(null);
  const foreign = lines.find((l) => l.currency !== c.currency);
  if (foreign) {
    return err(
      serviceError(
        'conflict',
        msg('periods.rateCurrency', {
          person: foreign.a.personName,
          rateCurrency: foreign.currency,
          contract: c.number,
          contractCurrency: c.currency,
        }),
      ),
    );
  }
  const annex = annexId ? input.annexes.get(annexId) : undefined;
  const issueDate = defaultInvoiceDate(
    (annex?.invoiceDateRule ?? c.invoiceDateRule) as InvoiceDateRule,
    input.month,
    input.cal,
  );
  const [inv] = await tx
    .insert(invoice)
    .values({
      clientId: c.clientId,
      contractId,
      annexId,
      periodId: input.periodId,
      issueDate,
      dueDate: dueDate(
        (annex?.paymentDueRule ?? c.paymentDueRule) as PaymentDueRule,
        issueDate,
        input.cal,
      ),
      currency: c.currency,
      total: sum(lines.map((l) => l.line.amount)).toFixed(2),
    })
    .returning({ id: invoice.id });
  if (!inv) throw new Error('Invoice insert returned no row');
  await tx.insert(invoiceLine).values(
    lines.map((l, i) => ({
      invoiceId: inv.id,
      timesheetId: input.timesheetIds.get(l.a.assignmentId) ?? null,
      position: i + 1,
      ...describe(l.a.personName, l.a.roleTitle),
      quantity: l.line.quantity,
      unitPrice: l.line.unitPrice,
      amount: l.line.amount,
    })),
  );
  return ok(inv);
}
