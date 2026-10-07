import type { DbTransaction } from '@tally/db';
import {
  adjustment,
  assignment,
  contract,
  contractAnnex,
  invoice,
  invoiceLine,
  payee,
  period,
  person,
  supplierAct,
  timesheet,
  type SupplierAct,
} from '@tally/db/schema';
import {
  Decimal,
  defaultActDate,
  endOfMonth,
  payrollPlan,
  payrollTotalUah,
  personHours,
  roundHalfUp,
  startOfMonth,
  sum,
  toDecimal,
  type ActDateRule,
  type LocalDate,
} from '@tally/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { carveAct } from '../acts';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError, type ServiceError } from '../errors';
import { decimalString } from '../fields';
import { ensureNbuRate } from '../fx';
import {
  invoiceGroups,
  invoiceKey,
  loadCalendar,
  loadPeriodData,
  writeDraftInvoice,
  type PeriodRow,
} from './data';
import { loadAdjustments, toPlanAdjustments } from './payroll';

/*
 * Documents before the period closes (A-076): a client invoice per contract (or SOW with its own
 * rules) and a monthly FOP act per person at an approved rate. Drafts follow the hours; an issued
 * document freezes the hours it covers.
 */

async function openPeriodRow(tx: DbTransaction, periodId: string) {
  const [p] = await tx.select().from(period).where(eq(period.id, periodId)).for('update');
  if (!p) return err(serviceError('not_found', 'periods.notFound'));
  if (p.status === 'closed') return err(serviceError('conflict', 'periods.closedOrMissing'));
  return ok(p);
}

/** Rebuilds one invoice group's draft from the current hours; `create` also starts a missing one. */
async function rebuildDraftInvoice(
  tx: DbTransaction,
  p: PeriodRow,
  target: { contractId: string; annexId: string | null },
  create: boolean,
): Promise<Result<{ id: string } | null, ServiceError>> {
  const sameGroup = and(
    eq(invoice.periodId, p.id),
    eq(invoice.contractId, target.contractId),
    target.annexId ? eq(invoice.annexId, target.annexId) : isNull(invoice.annexId),
  );
  const existing = await tx
    .select({ id: invoice.id, status: invoice.status, number: invoice.number })
    .from(invoice)
    .where(and(sameGroup, ne(invoice.status, 'void')));
  const issued = existing.find((i) => i.status !== 'draft');
  if (issued) {
    return create
      ? err(
          serviceError('conflict', msg('periods.alreadyInvoiced', { number: issued.number ?? '' })),
        )
      : ok(null);
  }
  if (!create && existing.length === 0) return ok(null);
  await tx.delete(invoice).where(and(sameGroup, eq(invoice.status, 'draft')));
  const data = await loadPeriodData(tx, p);
  const { groups, annexes } = await invoiceGroups(
    tx,
    data.month,
    p.workHours,
    data.assignments,
    data.annexIds,
  );
  const group = groups.get(invoiceKey(target.contractId, target.annexId));
  if (!group)
    return create ? err(serviceError('validation_error', 'periods.nothingToInvoice')) : ok(null);
  return writeDraftInvoice(tx, {
    periodId: p.id,
    month: data.month,
    cal: await loadCalendar(tx),
    group,
    annexes,
    timesheetIds: data.timesheetIds,
  });
}

/** Early draft invoices follow the hours until they are issued. */
export async function refreshEarlyInvoices(tx: DbTransaction, p: PeriodRow) {
  const drafts = await tx
    .selectDistinct({ contractId: invoice.contractId, annexId: invoice.annexId })
    .from(invoice)
    .where(and(eq(invoice.periodId, p.id), eq(invoice.status, 'draft')));
  for (const d of drafts) {
    const rebuilt = await rebuildDraftInvoice(tx, p, d, false);
    if (rebuilt.isErr()) return rebuilt;
  }
  return ok(null);
}

export const draftEarlyInvoice = defineService({
  name: 'periods.draftInvoice',
  input: z.object({
    periodId: z.uuid(),
    contractId: z.uuid(),
    annexId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().default(null)),
  }),
  handler: (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const p = await openPeriodRow(tx, input.periodId);
      if (p.isErr()) return err(p.error);
      return rebuildDraftInvoice(tx, p.value, input, true);
    }),
});

type PersonPay = {
  personId: string;
  personName: string;
  payeeId: string;
  payeeName: string;
  usd: string;
  uah: string;
  /** Pay per assignment, labelled for choosing what goes into which act (A-089). */
  lines: {
    assignmentId: string;
    amount: string;
    currency: string;
    clientName: string | null;
    roleTitle: string | null;
  }[];
  adjustments: {
    id: string;
    kind: string;
    amount: string;
    currency: string;
    reason: string;
    supplierActId: string | null;
  }[];
};

/** People paid in fiat to their FOP this month, with the USD and UAH parts of that pay. */
async function fiatPay(tx: DbTransaction, p: PeriodRow): Promise<PersonPay[]> {
  const data = await loadPeriodData(tx, p);
  const adjustments = await loadAdjustments(tx, p.id);
  const plan = payrollPlan(
    data.month,
    p.workHours,
    null,
    data.assignments,
    toPlanAdjustments(adjustments),
  ).filter((i) => i.payoutMethod === 'fiat');
  if (!plan.length) return [];
  const fops = await tx
    .select({
      personId: person.id,
      payeeId: payee.id,
      payeeName: sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn}, '')`,
    })
    .from(person)
    .innerJoin(payee, and(eq(payee.id, person.defaultPayeeId), eq(payee.kind, 'fop')))
    .where(
      inArray(
        person.id,
        plan.map((i) => i.personId),
      ),
    );
  return plan.flatMap((i) => {
    const fop = fops.find((f) => f.personId === i.personId);
    return fop
      ? [
          {
            personId: i.personId,
            personName: i.personName,
            payeeId: fop.payeeId,
            payeeName: fop.payeeName,
            usd: i.totalUsd,
            uah: i.totalUahPart,
            lines: i.lines.map((l) => {
              const a = data.assignments.find((x) => x.assignmentId === l.assignmentId);
              return {
                assignmentId: l.assignmentId,
                amount: l.amount,
                currency: l.currency,
                clientName: a?.clientName ?? null,
                roleTitle: a?.roleTitle ?? null,
              };
            }),
            adjustments: adjustments
              .filter(({ adjustment: a }) => a.personId === i.personId && a.payoutMethod === 'fiat')
              .map(({ adjustment: a }) => ({
                id: a.id,
                kind: a.kind,
                amount: a.amount,
                currency: a.currency,
                reason: a.reason,
                supplierActId: a.supplierActId,
              })),
          },
        ]
      : [];
  });
}

/** Monthly acts whose period starts in the month: one, or several split from it (A-089). */
export const actsOfMonth = (month: LocalDate) =>
  and(
    eq(supplierAct.type, 'monthly'),
    gte(supplierAct.periodFrom, month),
    lte(supplierAct.periodFrom, endOfMonth(month)),
    ne(supplierAct.status, 'void'),
  );

/** A person's acts of the month made before the close, by period. */
const earlyActsOf = (tx: DbTransaction, payeeId: string, month: LocalDate) =>
  tx
    .select()
    .from(supplierAct)
    .where(
      and(eq(supplierAct.payeeId, payeeId), actsOfMonth(month), isNull(supplierAct.payrollItemId)),
    )
    .orderBy(asc(supplierAct.periodFrom));

const actTotal = (pay: PersonPay, rate: string | null) =>
  payrollTotalUah(
    [
      { amount: pay.usd, currency: 'USD' },
      { amount: pay.uah, currency: 'UAH' },
    ],
    [],
    rate,
  );

/** Work and adjustments of a person's pay that go into an act; the act of the rest takes the others. */
function membersOf(pay: PersonPay, acts: readonly SupplierAct[], act: SupplierAct) {
  if (act.amountUsd !== null) {
    return {
      lines: pay.lines.filter((l) => act.assignmentIds?.includes(l.assignmentId)),
      adjustments: pay.adjustments.filter((a) => a.supplierActId === act.id),
    };
  }
  const taken = new Set(acts.flatMap((a) => a.assignmentIds ?? []));
  return {
    lines: pay.lines.filter((l) => !taken.has(l.assignmentId)),
    adjustments: pay.adjustments.filter((a) => a.supplierActId === null),
  };
}

/**
 * Early draft acts follow the pay at their approved rate until they are issued (A-076, A-089): an
 * act of chosen work is that work's USD × its rate + its UAH, an act split off by amount is its USD
 * × the rate, and the act of the rest takes the whole pay less every other act.
 */
async function syncEarlyActs(tx: DbTransaction, pay: PersonPay, acts: SupplierAct[]) {
  for (const act of acts) {
    if (act.status !== 'draft' || act.amountUsd === null) continue;
    const own = membersOf(pay, acts, act);
    const items = [...own.lines, ...own.adjustments];
    const usd =
      items.length === 0
        ? toDecimal(act.amountUsd)
        : sum(items.filter((x) => x.currency !== 'UAH').map((x) => x.amount));
    const uah = sum(items.filter((x) => x.currency === 'UAH').map((x) => x.amount));
    if (!usd.isZero() && act.fxRate === null) continue;
    const amountUah = usd.isZero() ? uah : roundHalfUp(usd.times(act.fxRate ?? '0')).plus(uah);
    act.amountUsd = usd.toFixed(8);
    act.amountUah = amountUah.toFixed(2);
    await tx
      .update(supplierAct)
      .set({ amountUsd: act.amountUsd, amountUah: act.amountUah })
      .where(eq(supplierAct.id, act.id));
  }
  const rest = acts.find((a) => a.amountUsd === null && a.status === 'draft');
  if (!rest) return;
  const total = actTotal(pay, rest.fxRate);
  if (total.isErr()) return;
  const others = sum(acts.filter((a) => a.amountUsd !== null).map((a) => a.amountUah));
  await tx
    .update(supplierAct)
    .set({ amountUah: Decimal.max(total.value.minus(others), 0).toFixed(2) })
    .where(eq(supplierAct.id, rest.id));
}

/** Early draft acts follow the pay at their approved rate until they are issued. */
export async function refreshEarlyActs(tx: DbTransaction, p: PeriodRow) {
  const month = p.month as LocalDate;
  for (const pay of await fiatPay(tx, p)) {
    const acts = await earlyActsOf(tx, pay.payeeId, month);
    if (acts.some((a) => a.status === 'draft')) await syncEarlyActs(tx, pay, acts);
  }
}

export const draftEarlyAct = defineService({
  name: 'periods.draftAct',
  input: z.object({
    periodId: z.uuid(),
    personId: z.uuid(),
    rate: z.preprocess(
      (v) => (v === '' ? undefined : v),
      decimalString.refine((v) => toDecimal(v).gt(0), 'fx.ratePositive2').optional(),
    ),
    rateSource: z.enum(['bank_actual', 'nbu', 'manual']).default('manual'),
  }),
  handler: (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const p = await openPeriodRow(tx, input.periodId);
      if (p.isErr()) return err(p.error);
      const month = p.value.month as LocalDate;
      const pay = (await fiatPay(tx, p.value)).find((x) => x.personId === input.personId);
      if (!pay) return err(serviceError('validation_error', 'periods.noFopPay'));
      const usdPart = !toDecimal(pay.usd).isZero();
      if (usdPart && !input.rate) {
        return err(
          serviceError('validation_error', 'payroll.rateFirst', { rate: ['payroll.rateFirst'] }),
        );
      }
      const rate = usdPart && input.rate ? toDecimal(input.rate).toFixed(6) : null;
      const total = actTotal(pay, rate);
      if (total.isErr()) return err(serviceError('validation_error', 'payroll.rateFirst'));
      const values = { fxRate: rate, fxSource: rate ? input.rateSource : null };

      // A person's acts of the month share the approved rate; issued ones keep theirs.
      const existing = await earlyActsOf(tx, pay.payeeId, month);
      if (existing.length) {
        const drafts = existing.filter((a) => a.status === 'draft');
        if (!drafts.length) {
          return err(
            serviceError(
              'conflict',
              msg('periods.actAlreadyIssued', { number: existing[0]?.number ?? '' }),
            ),
          );
        }
        await tx
          .update(supplierAct)
          .set(values)
          .where(
            inArray(
              supplierAct.id,
              drafts.map((a) => a.id),
            ),
          );
        await syncEarlyActs(tx, pay, await earlyActsOf(tx, pay.payeeId, month));
        return ok({ id: (drafts.find((a) => a.amountUsd === null) ?? drafts[0])?.id ?? '' });
      }
      const [fop] = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.payeeId, pay.payeeId), eq(contract.kind, 'fop')))
        .orderBy(desc(contract.signedOn))
        .limit(1);
      if (!fop) return err(serviceError('validation_error', 'periods.noFopContract'));
      const actDate =
        defaultActDate(fop.actDateRule as ActDateRule, month, await loadCalendar(tx)) ??
        endOfMonth(month);
      const [act] = await tx
        .insert(supplierAct)
        .values({
          contractId: fop.id,
          payeeId: pay.payeeId,
          type: 'monthly',
          actDate,
          periodFrom: month,
          periodTo: endOfMonth(month),
          amountUah: total.value.toFixed(2),
          ...values,
        })
        .returning({ id: supplierAct.id });
      return act ? ok(act) : err(serviceError('forbidden', 'general.forbidden'));
    }),
});

/**
 * Splits an act made before the close (A-089) as acts of a payout are split (A-085, A-086): the
 * chosen work and adjustments, or a USD share, go into a new act for the chosen days; the person's
 * pay is not in payroll lines yet, so work is chosen by assignment.
 */
export async function splitEarlyActIn(
  tx: DbTransaction,
  act: SupplierAct,
  input: {
    assignmentIds: string[];
    adjustmentIds: string[];
    amountUsd?: string | undefined;
    periodFrom: string;
    periodTo: string;
  },
) {
  const month = startOfMonth((act.periodFrom ?? act.actDate) as LocalDate);
  const [p] = await tx.select().from(period).where(eq(period.month, month));
  if (p?.status !== 'open') return err(serviceError('conflict', 'acts.splitDraftOnly'));
  const pay = (await fiatPay(tx, p)).find((x) => x.payeeId === act.payeeId);
  if (!pay) return err(serviceError('validation_error', 'periods.noFopPay'));
  const acts = await earlyActsOf(tx, act.payeeId, month);
  const isRest = act.amountUsd === null;
  const own = membersOf(pay, acts, act);
  const chosen = new Set([...input.assignmentIds, ...input.adjustmentIds]);
  const byAmount = input.amountUsd !== undefined;
  if (byAmount && chosen.size > 0) {
    return err(serviceError('validation_error', 'acts.splitAmountOrActivities'));
  }
  if (byAmount) {
    if (!isRest && own.lines.length + own.adjustments.length > 0) {
      return err(serviceError('validation_error', 'acts.splitAmountFromActivities'));
    }
    const available = isRest
      ? toDecimal(pay.usd).minus(sum(acts.flatMap((a) => (a.amountUsd ? [a.amountUsd] : []))))
      : toDecimal(act.amountUsd ?? '0');
    if (toDecimal(input.amountUsd ?? '0').gte(available)) {
      const tooBig = msg('acts.splitAmountTooBig', { max: available.toFixed(2) });
      return err(serviceError('validation_error', tooBig, { amountUsd: [tooBig] }));
    }
  } else {
    const members = [...own.lines.map((l) => l.assignmentId), ...own.adjustments.map((a) => a.id)];
    if (chosen.size === 0 || [...chosen].some((id) => !members.includes(id))) {
      return err(serviceError('validation_error', 'acts.splitChooseActivities'));
    }
    if (members.every((id) => chosen.has(id))) {
      return err(serviceError('validation_error', 'acts.splitKeepSome'));
    }
  }
  if (!isRest) {
    await tx
      .update(supplierAct)
      .set({
        assignmentIds: (act.assignmentIds ?? []).filter((id) => !chosen.has(id)),
        ...(byAmount && {
          amountUsd: toDecimal(act.amountUsd ?? '0')
            .minus(input.amountUsd ?? '0')
            .toFixed(8),
        }),
      })
      .where(eq(supplierAct.id, act.id));
  }
  const carved = await carveAct(tx, act, input, {
    amountUsd: toDecimal(input.amountUsd ?? '0').toFixed(8),
    assignmentIds: input.assignmentIds.length ? input.assignmentIds : null,
    fxRate: act.fxRate,
    fxSource: act.fxSource,
  });
  if (carved.isErr()) return err(carved.error);
  if (input.adjustmentIds.length) {
    await tx
      .update(adjustment)
      .set({ supplierActId: carved.value.id })
      .where(inArray(adjustment.id, input.adjustmentIds));
  }
  await syncEarlyActs(
    tx,
    await refreshedPay(tx, p, act.payeeId),
    await earlyActsOf(tx, act.payeeId, month),
  );
  return ok({ id: carved.value.id, keptActId: act.id });
}

async function refreshedPay(tx: DbTransaction, p: PeriodRow, payeeId: string) {
  const pay = (await fiatPay(tx, p)).find((x) => x.payeeId === payeeId);
  if (!pay) throw new Error('The pay of an act disappeared within its transaction');
  return pay;
}

/** Re-syncs the early acts of one payee after a merge (A-089). */
export async function syncEarlyActsOf(tx: DbTransaction, payeeId: string, month: LocalDate) {
  const [p] = await tx.select().from(period).where(eq(period.month, month));
  if (!p) return;
  const pay = (await fiatPay(tx, p)).find((x) => x.payeeId === payeeId);
  if (pay) await syncEarlyActs(tx, pay, await earlyActsOf(tx, payeeId, month));
}

/**
 * Hours an issued document already covers cannot change (A-076): client hours on an issued
 * invoice line, a person's paid hours once their monthly act is issued.
 */
export async function frozenHours(
  tx: DbTransaction,
  p: PeriodRow,
  entries: readonly { assignmentId: string; hours: string; payHours?: string | null }[],
): Promise<string | null> {
  if (!entries.length) return null;
  const ids = entries.map((e) => e.assignmentId);
  const stored = await tx
    .select({
      assignmentId: timesheet.assignmentId,
      hours: timesheet.hours,
      payHours: timesheet.payHours,
      personId: person.id,
      personName: person.fullName,
      payeeId: person.defaultPayeeId,
    })
    .from(timesheet)
    .innerJoin(assignment, eq(assignment.id, timesheet.assignmentId))
    .innerJoin(person, eq(person.id, assignment.personId))
    .where(and(eq(timesheet.periodId, p.id), inArray(timesheet.assignmentId, ids)));
  const invoiced = await tx
    .select({ timesheetId: invoiceLine.timesheetId, number: invoice.number })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
    .where(and(eq(invoice.periodId, p.id), notInArray(invoice.status, ['draft', 'void'])));
  const timesheets = await tx
    .select({ id: timesheet.id, assignmentId: timesheet.assignmentId })
    .from(timesheet)
    .where(and(eq(timesheet.periodId, p.id), inArray(timesheet.assignmentId, ids)));
  const monthActs = await tx
    .select({
      payeeId: supplierAct.payeeId,
      number: supplierAct.number,
      status: supplierAct.status,
      amountUsd: supplierAct.amountUsd,
      assignmentIds: supplierAct.assignmentIds,
    })
    .from(supplierAct)
    .where(actsOfMonth(p.month as LocalDate));
  // The act an assignment's pay goes into: the one it was chosen for, else the act of the rest.
  const actOf = (payeeId: string | null, assignmentId: string) => {
    const own = monthActs.filter((a) => a.payeeId === payeeId);
    const act =
      own.find((a) => a.assignmentIds?.includes(assignmentId)) ??
      own.find((a) => a.amountUsd === null);
    return act?.status === 'issued' ? act : undefined;
  };
  for (const e of entries) {
    const before = stored.find((s) => s.assignmentId === e.assignmentId);
    const ts = timesheets.find((t) => t.assignmentId === e.assignmentId);
    const inv = ts && invoiced.find((i) => i.timesheetId === ts.id);
    const oldHours = toDecimal(before?.hours ?? '0');
    if (inv && !oldHours.eq(toDecimal(e.hours))) {
      return msg('periods.hoursInvoiced', { number: inv.number ?? '' });
    }
    const act = before?.payeeId ? actOf(before.payeeId, e.assignmentId) : undefined;
    if (act) {
      const oldPaid = personHours({ hours: before?.hours ?? null, payHours: before?.payHours });
      const newPaid = personHours({
        hours: e.hours,
        payHours: e.payHours === undefined ? (before?.payHours ?? null) : e.payHours,
      });
      if (!toDecimal(oldPaid).eq(toDecimal(newPaid))) {
        return msg('periods.hoursActed', {
          number: act.number ?? '',
          person: before?.personName ?? '',
        });
      }
    }
  }
  return null;
}

/**
 * An adjustment would change an issued amount when its act is issued: the act it was put into, or
 * for a new one the act of the rest (A-089).
 */
export async function frozenAdjustments(
  tx: DbTransaction,
  p: PeriodRow,
  personId: string,
  actId: string | null = null,
) {
  const [act] = await tx
    .select({ number: supplierAct.number })
    .from(supplierAct)
    .innerJoin(person, eq(person.defaultPayeeId, supplierAct.payeeId))
    .where(
      and(
        eq(person.id, personId),
        actsOfMonth(p.month as LocalDate),
        actId ? eq(supplierAct.id, actId) : isNull(supplierAct.amountUsd),
        eq(supplierAct.status, 'issued'),
      ),
    );
  return act ? msg('periods.adjustmentActed', { number: act.number ?? '' }) : null;
}

export async function periodOf(tx: DbTransaction, periodId: string) {
  const [p] = await tx.select().from(period).where(eq(period.id, periodId));
  return p ?? null;
}

export async function periodOfAdjustment(tx: DbTransaction, adjustmentId: string) {
  const [row] = await tx
    .select({ period, personId: adjustment.personId, supplierActId: adjustment.supplierActId })
    .from(adjustment)
    .innerJoin(period, eq(period.id, adjustment.periodId))
    .where(eq(adjustment.id, adjustmentId));
  return row ?? null;
}

/** Step 3 documents: invoice groups and FOP acts with their state, for the wizard (A-076). */
export const periodDocuments = defineService({
  name: 'periods.documents',
  input: z.object({ periodId: z.uuid() }),
  handler: async (ctx, { periodId }) => {
    const nbu = await ensureNbuRate(ctx.db, 'USD', ctx.today);
    const data = await inActorScope(ctx, async (tx) => {
      const p = await periodOf(tx, periodId);
      if (!p) return null;
      const loaded = await loadPeriodData(tx, p);
      const { groups } = await invoiceGroups(
        tx,
        loaded.month,
        p.workHours,
        loaded.assignments,
        loaded.annexIds,
      );
      const invoices = await tx
        .select({
          id: invoice.id,
          contractId: invoice.contractId,
          annexId: invoice.annexId,
          status: invoice.status,
          number: invoice.number,
          total: invoice.total,
          currency: invoice.currency,
        })
        .from(invoice)
        .where(and(eq(invoice.periodId, periodId), ne(invoice.status, 'void')));
      const contractIds = [...new Set([...groups.values()].map((g) => g.contractId))];
      const contracts = contractIds.length
        ? await tx
            .select({ id: contract.id, number: contract.number, currency: contract.currency })
            .from(contract)
            .where(inArray(contract.id, contractIds))
        : [];
      const annexIds = [...groups.values()].flatMap((g) => (g.annexId ? [g.annexId] : []));
      const annexes = annexIds.length
        ? await tx
            .select({
              id: contractAnnex.id,
              kind: contractAnnex.kind,
              number: contractAnnex.number,
            })
            .from(contractAnnex)
            .where(inArray(contractAnnex.id, annexIds))
        : [];
      const pay = await fiatPay(tx, p);
      const acts = pay.length
        ? await tx
            .select()
            .from(supplierAct)
            .where(
              and(
                inArray(
                  supplierAct.payeeId,
                  pay.map((x) => x.payeeId),
                ),
                actsOfMonth(p.month as LocalDate),
              ),
            )
            .orderBy(asc(supplierAct.periodFrom))
        : [];
      return {
        open: p.status === 'open',
        invoices: [...groups.values()].map((g) => {
          const c = contracts.find((x) => x.id === g.contractId);
          const a = g.annexId ? annexes.find((x) => x.id === g.annexId) : undefined;
          const inv = invoices.find(
            (i) => i.contractId === g.contractId && i.annexId === g.annexId,
          );
          return {
            contractId: g.contractId,
            annexId: g.annexId,
            label: [
              g.lines[0]?.a.clientName,
              c?.number,
              a ? `${a.kind.toUpperCase()} ${a.number}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            people: g.lines.map((l) => l.a.personName),
            invoice: inv ?? null,
          };
        }),
        acts: pay.map((x) => {
          const own = acts.filter((a) => a.payeeId === x.payeeId);
          const rest = own.find((a) => a.amountUsd === null) ?? own[0];
          return {
            ...x,
            needsRate: !toDecimal(x.usd).isZero(),
            act: rest
              ? {
                  id: rest.id,
                  status: rest.status,
                  number: rest.number,
                  amountUah: rest.amountUah,
                  fxRate: rest.fxRate,
                }
              : null,
            /** Every act of the month (A-089), with what goes into each. */
            acts: own.map((a) => {
              const m = membersOf(x, own, a);
              return {
                id: a.id,
                status: a.status,
                number: a.number,
                amountUah: a.amountUah,
                amountUsd: a.amountUsd,
                fxRate: a.fxRate,
                periodFrom: a.periodFrom,
                periodTo: a.periodTo,
                isRest: a.amountUsd === null,
                payrollItemId: a.payrollItemId,
                assignmentIds: m.lines.map((l) => l.assignmentId),
                adjustmentIds: m.adjustments.map((j) => j.id),
              };
            }),
          };
        }),
      };
    });
    if (!data) return err(serviceError('not_found', 'periods.notFound'));
    return ok({ ...data, nbuRate: nbu.isOk() ? nbu.value.rate : null });
  },
});
