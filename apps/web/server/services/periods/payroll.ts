import type { DbTransaction } from '@tally/db';
import {
  adjustment,
  invoice,
  invoiceLine,
  payee,
  payrollItem,
  payrollLine,
  person,
} from '@tally/db/schema';
import {
  toDecimal,
  resolvePayability,
  resolvePayee,
  type AgencyPlanItem,
  type LocalDate,
  type PeriodAssignment,
  type PlanAdjustment,
  type PlanItem,
  type PlanLine,
  type WorkCalendar,
} from '@tally/domain';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';

export async function loadAdjustments(tx: DbTransaction, periodId: string) {
  return tx
    .select({ adjustment, personName: person.fullName })
    .from(adjustment)
    .innerJoin(person, eq(person.id, adjustment.personId))
    .where(eq(adjustment.periodId, periodId))
    .orderBy(person.fullName, adjustment.createdAt);
}

export const toPlanAdjustments = (
  rows: Awaited<ReturnType<typeof loadAdjustments>>,
): PlanAdjustment[] =>
  rows.map(({ adjustment: a }) => ({
    personId: a.personId,
    payoutMethod: a.payoutMethod,
    amount: a.amount,
    currency: a.currency,
  }));

/**
 * Step 5 (6.4): payroll items and lines from the plan, then one item per agency payee for the
 * agency fees (A-068). A line is funded by the invoice line of the same timesheet (5.3 rule 1) —
 * agency fees too, so they wait for the client like the person's pay; its status comes from
 * resolvePayability at the closing date.
 */
export async function createPayroll(
  tx: DbTransaction,
  input: {
    periodId: string;
    plan: PlanItem[];
    agency: AgencyPlanItem[];
    assignments: readonly PeriodAssignment[];
    timesheetIds: Map<string, string>;
    today: LocalDate;
    cal: WorkCalendar;
  },
) {
  const timesheets = [...input.timesheetIds.values()];
  const funded = timesheets.length
    ? await tx
        .select({
          lineId: invoiceLine.id,
          timesheetId: invoiceLine.timesheetId,
          total: invoice.total,
          paidAmount: invoice.paidAmount,
          dueDate: invoice.dueDate,
        })
        .from(invoiceLine)
        .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
        .where(and(inArray(invoiceLine.timesheetId, timesheets), ne(invoice.status, 'void')))
    : [];
  const fundingOf = new Map(funded.map((f) => [f.timesheetId, f]));

  const personIds = [...new Set(input.plan.map((i) => i.personId))];
  const people = personIds.length
    ? await tx
        .select({ id: person.id, defaultPayeeId: person.defaultPayeeId })
        .from(person)
        .where(inArray(person.id, personIds))
    : [];
  const payees = personIds.length
    ? await tx
        .select({ id: payee.id, kind: payee.kind, personId: payee.personId })
        .from(payee)
        .where(
          or(
            inArray(payee.personId, personIds),
            inArray(
              payee.id,
              people.flatMap((p) => (p.defaultPayeeId ? [p.defaultPayeeId] : [])),
            ),
          ),
        )
    : [];

  const insertLines = async (itemId: string, lines: PlanLine[], agencyFee: boolean) => {
    if (lines.length === 0) return;
    await tx.insert(payrollLine).values(
      lines.map((l) => {
        const timesheetId = input.timesheetIds.get(l.assignmentId) ?? null;
        const fund = timesheetId ? fundingOf.get(timesheetId) : undefined;
        const state = resolvePayability(
          fund
            ? { total: fund.total, paidAmount: fund.paidAmount, dueDate: fund.dueDate as LocalDate }
            : null,
          { releasePolicy: l.releasePolicy, graceDays: l.graceDays },
          input.today,
          input.cal,
        );
        return {
          payrollItemId: itemId,
          assignmentId: l.assignmentId,
          timesheetId,
          amount: l.amount,
          currency: l.currency,
          agencyFee,
          fundedByInvoiceLineId: fund?.lineId ?? null,
          status: state.payable ? ('payable' as const) : ('awaiting_client' as const),
          fundingSource: state.payable ? state.funding : null,
          payableAt: state.payable ? new Date() : null,
        };
      }),
    );
  };

  let items = 0;
  for (const plan of input.plan) {
    const owner = people.find((p) => p.id === plan.personId);
    const candidates = payees
      .filter((p) => p.personId === plan.personId || p.id === owner?.defaultPayeeId)
      .map((p) => ({ id: p.id, kind: p.kind as 'fop' | 'crypto' | 'other' }));
    const [item] = await tx
      .insert(payrollItem)
      .values({
        periodId: input.periodId,
        personId: plan.personId,
        payoutMethod: plan.payoutMethod,
        payeeId: resolvePayee(plan.payoutMethod, owner?.defaultPayeeId ?? null, candidates),
        totalUsd: plan.totalUsd,
        // Paid only in UAH: the total needs no rate (A-075).
        totalUah:
          plan.payoutMethod === 'fiat' && toDecimal(plan.totalUsd).isZero()
            ? plan.totalUahPart
            : null,
      })
      .returning({ id: payrollItem.id });
    if (!item) throw new Error('Payroll item insert returned no row');
    await insertLines(item.id, plan.lines, false);
    await tx.execute(sql`select public.refresh_payroll_item(${item.id})`);
    items++;
  }
  for (const plan of input.agency) {
    const [item] = await tx
      .insert(payrollItem)
      .values({
        kind: 'agency',
        periodId: input.periodId,
        payeeId: plan.payeeId,
        payoutMethod: plan.payoutMethod,
        totalUsd: plan.totalUsd,
      })
      .returning({ id: payrollItem.id });
    if (!item) throw new Error('Payroll item insert returned no row');
    await insertLines(item.id, plan.lines, true);
    await tx.execute(sql`select public.refresh_payroll_item(${item.id})`);
    items++;
  }
  return items;
}

/** Reopening drops the payroll of the period (only possible while nothing is paid, TL032). */
export async function dropPayroll(tx: DbTransaction, periodId: string) {
  await tx.delete(payrollItem).where(eq(payrollItem.periodId, periodId));
}
