import type { DbTransaction } from '@tally/db';
import {
  adjustment,
  invoice,
  invoiceLine,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import {
  payrollTotalUah,
  payrollTotalUsd,
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
  type PayoutMethod,
} from '@tally/domain';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ensureMonthlyActDraft, syncMonthlyActDraft } from '../acts';
import { actsOfMonth } from './early';

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
    /** NBU USD→UAH on the closing day; fiat items with a USD part get it, editable later. */
    payoutRate: string | null;
  },
) {
  const month = (
    await tx.select({ month: period.month }).from(period).where(eq(period.id, input.periodId))
  )[0]?.month as LocalDate;
  /** total_uah and the rate snapshot of a fiat item; crypto items have neither (A-075, A-076). */
  const fiatTotals = async (
    method: PayoutMethod,
    payeeId: string | null,
    lines: PlanLine[],
    adjustments: PlanItem['adjustments'],
  ) => {
    if (method !== 'fiat') return {};
    // A monthly act made before the close carries the rate approved for it (A-076).
    const waiting = payeeId ? await waitingMonthlyActs(tx, payeeId, month) : [];
    const early = waiting.find((a) => a.amountUsd === null) ?? waiting[0];
    const approved = early?.fxRate
      ? { rate: early.fxRate, source: early.fxSource ?? ('manual' as const) }
      : input.payoutRate
        ? { rate: input.payoutRate, source: 'nbu' as const }
        : null;
    const usdPart = payrollTotalUsd(lines, adjustments);
    const rate = usdPart.isZero() ? null : approved;
    const total = payrollTotalUah(lines, adjustments, rate?.rate ?? null);
    if (total.isErr()) return {};
    return {
      totalUah: total.value.toFixed(2),
      ...(rate && {
        payoutFxRate: toDecimal(rate.rate).toFixed(6),
        fxSource: rate.source,
        fxSetAt: new Date(),
      }),
    };
  };
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

  const insertLines = async (
    itemId: string,
    lines: PlanLine[],
    agencyFee: boolean,
    payeeId: string | null = null,
  ) => {
    if (lines.length === 0) return;
    // Work chosen for an act before the close goes into it (A-089).
    const chosen = payeeId ? await waitingMonthlyActs(tx, payeeId, month) : [];
    const actOf = (assignmentId: string) =>
      chosen.find((a) => a.assignmentIds?.includes(assignmentId))?.id ?? null;
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
          supplierActId: agencyFee ? null : actOf(l.assignmentId),
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
    const payeeId = resolvePayee(plan.payoutMethod, owner?.defaultPayeeId ?? null, candidates);
    const [item] = await tx
      .insert(payrollItem)
      .values({
        periodId: input.periodId,
        personId: plan.personId,
        payoutMethod: plan.payoutMethod,
        payeeId,
        totalUsd: plan.totalUsd,
        ...(await fiatTotals(plan.payoutMethod, payeeId, plan.lines, plan.adjustments)),
      })
      .returning({ id: payrollItem.id });
    if (!item) throw new Error('Payroll item insert returned no row');
    await insertLines(item.id, plan.lines, false, plan.payoutMethod === 'fiat' ? payeeId : null);
    await tx.execute(sql`select public.refresh_payroll_item(${item.id})`);
    await attachMonthlyAct(tx, item.id, month);
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
        ...(await fiatTotals(plan.payoutMethod, plan.payeeId, plan.lines, [])),
      })
      .returning({ id: payrollItem.id });
    if (!item) throw new Error('Payroll item insert returned no row');
    await insertLines(item.id, plan.lines, true);
    await tx.execute(sql`select public.refresh_payroll_item(${item.id})`);
    await attachMonthlyAct(tx, item.id, month);
    items++;
  }
  return items;
}

/**
 * The monthly FOP act of a fresh payroll item (A-076): a draft left from an earlier close (or made
 * before it) is linked again and follows the new total; otherwise a new draft is created.
 */
/** Monthly acts of a payee and month not linked to a payout yet: made before the close. */
function waitingMonthlyActs(tx: DbTransaction, payeeId: string, month: LocalDate) {
  return tx
    .select()
    .from(supplierAct)
    .where(
      and(eq(supplierAct.payeeId, payeeId), actsOfMonth(month), isNull(supplierAct.payrollItemId)),
    )
    .orderBy(asc(supplierAct.periodFrom));
}

async function attachMonthlyAct(tx: DbTransaction, itemId: string, month: LocalDate) {
  const [item] = await tx.select().from(payrollItem).where(eq(payrollItem.id, itemId));
  if (!item?.payeeId || item.payoutMethod !== 'fiat' || !item.totalUah) return;
  const waiting = await waitingMonthlyActs(tx, item.payeeId, month);
  if (waiting.length) {
    // Issued acts are linked as they are (set once, A-076); drafts follow the new total. A month
    // split before the close keeps its acts (A-089).
    await tx
      .update(supplierAct)
      .set({ payrollItemId: itemId })
      .where(
        inArray(
          supplierAct.id,
          waiting.map((a) => a.id),
        ),
      );
    if (waiting.some((a) => a.status === 'draft')) await syncMonthlyActDraft(tx, itemId);
    return;
  }
  await ensureMonthlyActDraft(tx, itemId);
}

/**
 * Reopening drops the payroll of the period (only possible while nothing is paid, TL032). Draft
 * monthly acts stay, detached, and are linked again at the next close with their rate (A-076).
 */
export async function dropPayroll(tx: DbTransaction, periodId: string) {
  const items = tx
    .select({ id: payrollItem.id })
    .from(payrollItem)
    .where(eq(payrollItem.periodId, periodId));
  await tx
    .update(supplierAct)
    .set({ payrollItemId: null })
    .where(and(inArray(supplierAct.payrollItemId, items), eq(supplierAct.status, 'draft')));
  await tx.delete(payrollItem).where(eq(payrollItem.periodId, periodId));
}
