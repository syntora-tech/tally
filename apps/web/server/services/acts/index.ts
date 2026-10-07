import type { DbTransaction } from '@tally/db';
import {
  adjustment,
  company,
  contract,
  payee,
  payrollItem,
  payrollLine,
  period,
  supplierAct,
  type SupplierAct,
} from '@tally/db/schema';
import {
  addDays,
  addMonths,
  defaultActDate,
  Decimal,
  endOfMonth,
  nextPartPeriod,
  payoutPartOf,
  payoutRest,
  roundHalfUp,
  startOfMonth,
  sum,
  toDecimal,
  type ActDateRule,
  type AdjustmentInput,
  type LocalDate,
  type PayLineInput,
  type PayoutPart,
  type WorkCalendar,
} from '@tally/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { enqueueJob, type NewJob } from '../../jobs/queue';
import { inActorScopeAtomic } from '../atomic';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import {
  decimalString,
  httpUrl,
  localDateString,
  optionalLocalDate,
  optionalText,
  requiredText,
} from '../fields';
import { loadCalendar } from '../periods';
import { splitEarlyActIn, syncEarlyActsOf } from '../periods/early';
import { buildActSnapshot } from './snapshot';

const payeeName = sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;

export const renderActJob = (actId: string): NewJob => ({
  kind: 'render_act',
  payload: { actId },
  dedupeKey: `render_act:${actId}`,
});

/**
 * Draft monthly act for a fiat FOP payout (6.6): date by the contract's act rule (default — last
 * working day of the period), amount = the item's total_uah. One act per payroll item.
 */
export async function ensureMonthlyActDraft(tx: DbTransaction, itemId: string) {
  const [row] = await tx
    .select({ item: payrollItem, month: period.month, payeeKind: payee.kind })
    .from(payrollItem)
    .innerJoin(period, eq(period.id, payrollItem.periodId))
    .leftJoin(payee, eq(payee.id, payrollItem.payeeId))
    .where(eq(payrollItem.id, itemId));
  if (!row?.item.payeeId || row.payeeKind !== 'fop' || row.item.payoutMethod !== 'fiat')
    return null;
  if (!row.item.totalUah) return null;
  const [existing] = await tx
    .select({ id: supplierAct.id })
    .from(supplierAct)
    .where(and(eq(supplierAct.payrollItemId, itemId), sql`${supplierAct.status} <> 'void'`));
  if (existing) return existing;
  const [fop] = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.payeeId, row.item.payeeId), eq(contract.kind, 'fop')))
    .orderBy(desc(contract.signedOn))
    .limit(1);
  if (!fop) return null;
  const month = row.month as LocalDate;
  const cal = await loadCalendar(tx);
  const actDate = defaultActDate(fop.actDateRule as ActDateRule, month, cal) ?? endOfMonth(month);
  const [act] = await tx
    .insert(supplierAct)
    .values({
      contractId: fop.id,
      payeeId: row.item.payeeId,
      payrollItemId: itemId,
      type: 'monthly',
      actDate,
      periodFrom: month,
      periodTo: endOfMonth(month),
      amountUah: row.item.totalUah,
    })
    .returning({ id: supplierAct.id });
  return act ?? null;
}

/** Non-void monthly acts of a payout by period: one, or one per part (A-083). */
export function monthlyActsOf(tx: DbTransaction, itemId: string) {
  return tx
    .select()
    .from(supplierAct)
    .where(
      and(
        eq(supplierAct.payrollItemId, itemId),
        eq(supplierAct.type, 'monthly'),
        ne(supplierAct.status, 'void'),
      ),
    )
    .orderBy(asc(supplierAct.periodFrom));
}

/** Parts of a payout paid on their own (acts with a USD share), as the domain sees them. */
export const partsOf = (acts: readonly SupplierAct[]): PayoutPart[] =>
  acts
    .filter((a) => a.amountUsd !== null)
    .map((a) => ({ usd: a.amountUsd ?? '0', uah: a.amountUah, rate: a.fxRate }));

/** Parts whose rate is fixed (paid), as the domain sees them (A-085). */
export const lockedPartsOf = (acts: readonly SupplierAct[]): PayoutPart[] =>
  partsOf(acts.filter((a) => a.rateLocked));

/** Lines and adjustments of a payout with the act each goes into (A-085). */
export async function activitiesOf(tx: DbTransaction, itemId: string) {
  const [item] = await tx.select().from(payrollItem).where(eq(payrollItem.id, itemId));
  if (!item) return null;
  const lines = await tx
    .select({
      id: payrollLine.id,
      assignmentId: payrollLine.assignmentId,
      amount: payrollLine.amount,
      currency: payrollLine.currency,
      supplierActId: payrollLine.supplierActId,
    })
    .from(payrollLine)
    .where(eq(payrollLine.payrollItemId, itemId));
  // Adjustments belong to people; an agency item has none (A-068).
  const adjustments = item.personId
    ? await tx
        .select({
          id: adjustment.id,
          amount: adjustment.amount,
          currency: adjustment.currency,
          supplierActId: adjustment.supplierActId,
        })
        .from(adjustment)
        .where(
          and(
            eq(adjustment.periodId, item.periodId),
            eq(adjustment.personId, item.personId),
            eq(adjustment.payoutMethod, item.payoutMethod),
          ),
        )
    : [];
  return { item, lines, adjustments };
}

/**
 * Draft acts follow their payout (A-076, A-083, A-085): an act of activities (lines and
 * adjustments chosen for it) is their USD × the payout rate + their UAH until its part is paid;
 * the act of the rest takes total_uah less every other act. With a single act that is the whole
 * total.
 */
export async function syncMonthlyActDraft(tx: DbTransaction, itemId: string) {
  const data = await activitiesOf(tx, itemId);
  if (!data?.item.totalUah) return;
  const { item } = data;
  const acts = await monthlyActsOf(tx, itemId);
  for (const act of acts) {
    if (act.status !== 'draft' || act.rateLocked || act.amountUsd === null) continue;
    const own = [...data.lines, ...data.adjustments].filter((x) => x.supplierActId === act.id);
    // An act split off by amount has no activities of its own: its USD share stays as chosen.
    const usd =
      own.length === 0
        ? toDecimal(act.amountUsd)
        : sum(own.filter((x) => x.currency !== 'UAH').map((x) => x.amount));
    const uah = sum(own.filter((x) => x.currency === 'UAH').map((x) => x.amount));
    const rate = usd.isZero() ? null : item.payoutFxRate;
    const amountUah = rate === null ? uah : roundHalfUp(usd.times(rate)).plus(uah);
    act.amountUah = amountUah.toFixed(2);
    await tx
      .update(supplierAct)
      .set({
        amountUsd: usd.toFixed(8),
        amountUah: act.amountUah,
        fxRate: rate,
        fxSource: rate ? item.fxSource : null,
      })
      .where(eq(supplierAct.id, act.id));
  }
  const others = sum(acts.filter((a) => a.amountUsd !== null).map((a) => a.amountUah));
  const rest = Decimal.max(toDecimal(item.totalUah ?? '0').minus(others), 0).toFixed(2);
  await tx
    .update(supplierAct)
    .set({ amountUah: rest })
    .where(
      and(
        eq(supplierAct.payrollItemId, itemId),
        eq(supplierAct.type, 'monthly'),
        eq(supplierAct.status, 'draft'),
        isNull(supplierAct.amountUsd),
      ),
    );
}

/** The act date of a part: its last working day, as for a whole month (D9). */
function partActDate(cal: WorkCalendar, to: LocalDate, from: LocalDate) {
  const day = cal.previousWorkingDayOnOrBefore(to);
  return day < from ? to : day;
}

/**
 * A payment of part of a month (A-083) splits the act of the rest: the paid part keeps the act
 * with its USD share, rate and period up to the payout day; a new draft takes the rest of the
 * month. A payment of the whole rest leaves the act as it is. Nothing happens once the act of the
 * rest is issued — it was signed for the whole month.
 */
export async function splitActForPayment(
  tx: DbTransaction,
  input: {
    itemId: string;
    paidUah: string;
    paidOn: LocalDate;
    lines: readonly PayLineInput[];
    adjustments: readonly AdjustmentInput[];
    period?: { from: LocalDate; to: LocalDate } | null;
  },
) {
  const [item] = await tx
    .select({ item: payrollItem, month: period.month })
    .from(payrollItem)
    .innerJoin(period, eq(period.id, payrollItem.periodId))
    .where(eq(payrollItem.id, input.itemId));
  if (!item) return ok(null);
  const acts = await monthlyActsOf(tx, input.itemId);
  const restAct = acts.find((a) => a.amountUsd === null);
  if (restAct?.status !== 'draft') return ok(null);
  const parts = acts.filter((a) => a.amountUsd !== null);
  const rest = payoutRest(input.lines, input.adjustments, partsOf(acts));
  const part = payoutPartOf(rest, input.paidUah, item.item.payoutFxRate);
  if (part.coversRest) return ok(null);
  const month = item.month as LocalDate;
  const range =
    input.period ??
    nextPartPeriod(
      month,
      parts.map((a) => ({
        from: (a.periodFrom ?? month) as LocalDate,
        to: (a.periodTo ?? month) as LocalDate,
      })),
      input.paidOn,
      false,
    );
  const end = endOfMonth(month);
  if (!range || range.to >= end) {
    return err(serviceError('validation_error', 'payroll.noDaysForRest'));
  }
  const cal = await loadCalendar(tx);
  await tx
    .update(supplierAct)
    .set({
      amountUsd: part.usd.toFixed(8),
      amountUah: part.uah.toFixed(2),
      rateLocked: true,
      fxRate: item.item.payoutFxRate,
      fxSource: item.item.payoutFxRate ? item.item.fxSource : null,
      periodFrom: range.from,
      periodTo: range.to,
      actDate: partActDate(cal, range.to, range.from),
    })
    .where(eq(supplierAct.id, restAct.id));
  const [next] = await tx
    .insert(supplierAct)
    .values({
      contractId: restAct.contractId,
      payeeId: restAct.payeeId,
      payrollItemId: input.itemId,
      type: 'monthly',
      actDate: restAct.actDate,
      periodFrom: addDays(range.to, 1),
      periodTo: end,
      amountUah: '0',
    })
    .returning({ id: supplierAct.id });
  await syncMonthlyActDraft(tx, input.itemId);
  return ok({ partActId: restAct.id, restActId: next?.id ?? null });
}

/**
 * Joins two neighbouring draft acts of one payout — or of one person's month before the close
 * (A-089) — into one act and one period (A-083). With the act of the rest it becomes the rest; two
 * parts add up, at their average rate.
 */
export async function mergeActsIn(tx: DbTransaction, firstId: string, secondId: string) {
  const rows = await tx
    .select()
    .from(supplierAct)
    .where(inArray(supplierAct.id, [firstId, secondId]))
    .for('update');
  const [a, b] = rows.sort((x, y) => (x.periodFrom ?? '').localeCompare(y.periodFrom ?? ''));
  if (!a || !b || a.id === b.id) return err(serviceError('not_found', 'acts.notFound'));
  const early =
    a.payrollItemId === null &&
    b.payrollItemId === null &&
    a.type === 'monthly' &&
    b.type === 'monthly' &&
    a.payeeId === b.payeeId;
  if (
    (!early && (a.payrollItemId === null || a.payrollItemId !== b.payrollItemId)) ||
    a.status !== 'draft' ||
    b.status !== 'draft' ||
    !a.periodTo ||
    !b.periodFrom ||
    addDays(a.periodTo as LocalDate, 1) !== b.periodFrom
  ) {
    return err(serviceError('validation_error', 'acts.mergeAdjacentDrafts'));
  }
  const toRest = a.amountUsd === null || b.amountUsd === null;
  const locked = a.rateLocked || b.rateLocked;
  if (!toRest && !locked) {
    // An act of activities follows them alone, so it cannot absorb an act split off by amount.
    const owns = async (act: SupplierAct) =>
      (act.assignmentIds?.length ?? 0) > 0 ||
      (
        await tx
          .select({ id: adjustment.id })
          .from(adjustment)
          .where(eq(adjustment.supplierActId, act.id))
      ).length > 0 ||
      (
        await tx
          .select({ id: payrollLine.id })
          .from(payrollLine)
          .where(eq(payrollLine.supplierActId, act.id))
      ).length > 0;
    if ((await owns(a)) !== (await owns(b))) {
      return err(serviceError('validation_error', 'acts.mergeAmountWithActivities'));
    }
  }
  const usd = toDecimal(a.amountUsd ?? '0').plus(b.amountUsd ?? '0');
  const uah = toDecimal(a.amountUah).plus(b.amountUah);
  // Activities move first: deleting the second act would send them to the rest (A-085).
  for (const table of [payrollLine, adjustment] as const) {
    await tx
      .update(table)
      .set({ supplierActId: toRest ? null : a.id })
      .where(inArray(table.supplierActId, [a.id, b.id]));
  }
  await tx.delete(supplierAct).where(eq(supplierAct.id, b.id));
  const assignments = [...(a.assignmentIds ?? []), ...(b.assignmentIds ?? [])];
  await tx
    .update(supplierAct)
    .set({
      periodTo: b.periodTo,
      actDate: b.actDate,
      amountUah: uah.toFixed(2),
      amountUsd: toRest ? null : usd.toFixed(8),
      assignmentIds: toRest || assignments.length === 0 ? null : assignments,
      rateLocked: !toRest && locked,
      ...(!early && {
        fxRate: toRest || usd.isZero() ? null : uah.div(usd).toFixed(6),
        fxSource: toRest || usd.isZero() ? null : ('manual' as const),
      }),
    })
    .where(eq(supplierAct.id, a.id));
  if (a.payrollItemId) await syncMonthlyActDraft(tx, a.payrollItemId);
  else await syncEarlyActsOf(tx, a.payeeId, startOfMonth(a.periodFrom as LocalDate));
  return ok({ id: a.id });
}

export const splitActInput = z.object({
  actId: z.uuid(),
  /** Lines (activities) and adjustments that go into the new act. */
  lineIds: z.array(z.uuid()).default([]),
  /** Before the close there are no lines yet: the work is chosen by assignment (A-089). */
  assignmentIds: z.array(z.uuid()).default([]),
  adjustmentIds: z.array(z.uuid()).default([]),
  /** Or a USD share of this act for the new one, e.g. with a single activity (A-086). */
  amountUsd: z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(',', '.').trim() || undefined : v),
    decimalString
      .refine((v) => toDecimal(v).gt(0), 'field.positive')
      .optional()
      .describe('USD share for the new act instead of activities'),
  ),
  /** The new act's period: at the start or the end of the act being split. */
  periodFrom: localDateString,
  periodTo: localDateString,
});

/**
 * Cuts the chosen days off a draft act into a new one (A-085): the days must start or end with
 * the act's period and leave it some; the old act keeps the other days.
 */
export async function carveAct(
  tx: DbTransaction,
  act: SupplierAct,
  range: { periodFrom: string; periodTo: string },
  values: Partial<typeof supplierAct.$inferInsert>,
) {
  const from = (act.periodFrom ?? range.periodFrom) as LocalDate;
  const to = (act.periodTo ?? range.periodTo) as LocalDate;
  const atStart = range.periodFrom === from && range.periodTo < to;
  const atEnd = range.periodTo === to && range.periodFrom > from;
  if (range.periodFrom > range.periodTo || (!atStart && !atEnd)) {
    return err(serviceError('validation_error', 'acts.splitAtEdge'));
  }
  const cal = await loadCalendar(tx);
  const keep = atStart
    ? { from: addDays(range.periodTo as LocalDate, 1), to }
    : { from, to: addDays(range.periodFrom as LocalDate, -1) };
  await tx
    .update(supplierAct)
    .set({
      periodFrom: keep.from,
      periodTo: keep.to,
      actDate:
        act.actDate > keep.to || act.actDate < keep.from
          ? partActDate(cal, keep.to, keep.from)
          : act.actDate,
    })
    .where(eq(supplierAct.id, act.id));
  const [created] = await tx
    .insert(supplierAct)
    .values({
      contractId: act.contractId,
      payeeId: act.payeeId,
      payrollItemId: act.payrollItemId,
      type: 'monthly',
      actDate: partActDate(cal, range.periodTo as LocalDate, range.periodFrom as LocalDate),
      periodFrom: range.periodFrom,
      periodTo: range.periodTo,
      amountUah: '0',
      ...values,
    })
    .returning({ id: supplierAct.id });
  return created ? ok(created) : err(serviceError('internal_error', 'general.createFailed'));
}

/**
 * Splits a draft act by activity (A-085) or by a USD share (A-086): the chosen lines and
 * adjustments go into a new act for the chosen period at one edge of the old one; the rest keep
 * the old act and the other days. Amounts follow from the activities, so none is typed in. An act
 * made before the close is split by assignment (A-089).
 */
export async function splitActByActivityIn(
  tx: DbTransaction,
  input: z.output<typeof splitActInput>,
) {
  const [act] = await tx
    .select()
    .from(supplierAct)
    .where(eq(supplierAct.id, input.actId))
    .for('update');
  if (!act || act.type !== 'monthly') {
    return err(serviceError('not_found', 'acts.notFound'));
  }
  if (act.status !== 'draft' || act.rateLocked) {
    return err(serviceError('conflict', 'acts.splitDraftOnly'));
  }
  if (!act.payrollItemId) return splitEarlyActIn(tx, act, input);
  const data = await activitiesOf(tx, act.payrollItemId);
  if (!data) return err(serviceError('not_found', 'acts.notFound'));
  const isRest = act.amountUsd === null;
  const inAct = (x: { supplierActId: string | null }) =>
    isRest ? x.supplierActId === null : x.supplierActId === act.id;
  const members = [...data.lines, ...data.adjustments].filter(inAct);
  const lineIds = [
    ...input.lineIds,
    ...data.lines.filter((l) => input.assignmentIds.includes(l.assignmentId)).map((l) => l.id),
  ];
  const chosen = new Set([...lineIds, ...input.adjustmentIds]);
  const byAmount = input.amountUsd !== undefined;
  if (byAmount && chosen.size > 0) {
    return err(serviceError('validation_error', 'acts.splitAmountOrActivities'));
  }
  if (byAmount) {
    if (!isRest && members.length > 0) {
      return err(serviceError('validation_error', 'acts.splitAmountFromActivities'));
    }
    const acts = await monthlyActsOf(tx, act.payrollItemId);
    const available = isRest
      ? payoutRest(data.lines, data.adjustments, partsOf(acts)).usd
      : toDecimal(act.amountUsd ?? '0');
    if (toDecimal(input.amountUsd ?? '0').gte(available)) {
      const tooBig = msg('acts.splitAmountTooBig', { max: available.toFixed(2) });
      return err(serviceError('validation_error', tooBig, { amountUsd: [tooBig] }));
    }
  } else {
    if (chosen.size === 0 || [...chosen].some((id) => !members.some((m) => m.id === id))) {
      return err(serviceError('validation_error', 'acts.splitChooseActivities'));
    }
    if (members.every((m) => chosen.has(m.id))) {
      return err(serviceError('validation_error', 'acts.splitKeepSome'));
    }
  }
  // The work chosen is kept by assignment too, so a reopened and closed month splits the same way.
  const assignments = data.lines.filter((l) => chosen.has(l.id)).map((l) => l.assignmentId);
  if (!isRest) {
    await tx
      .update(supplierAct)
      .set({
        assignmentIds: (act.assignmentIds ?? []).filter((id) => !assignments.includes(id)),
        ...(byAmount && {
          amountUsd: toDecimal(act.amountUsd ?? '0')
            .minus(input.amountUsd ?? '0')
            .toFixed(8),
        }),
      })
      .where(eq(supplierAct.id, act.id));
  }
  const created = await carveAct(tx, act, input, {
    amountUsd: toDecimal(input.amountUsd ?? '0').toFixed(8),
    assignmentIds: assignments.length ? assignments : null,
  });
  if (created.isErr()) return err(created.error);
  if (lineIds.length) {
    await tx
      .update(payrollLine)
      .set({ supplierActId: created.value.id })
      .where(inArray(payrollLine.id, lineIds));
  }
  if (input.adjustmentIds.length) {
    await tx
      .update(adjustment)
      .set({ supplierActId: created.value.id })
      .where(inArray(adjustment.id, input.adjustmentIds));
  }
  await syncMonthlyActDraft(tx, act.payrollItemId);
  return ok({ id: created.value.id, keptActId: act.id });
}

export const splitActByActivity = defineService({
  name: 'acts.splitByActivity',
  input: splitActInput,
  handler: async (ctx, input) => inActorScope(ctx, (tx) => splitActByActivityIn(tx, input)),
});

/** Splitting payout acts for agents (A-085): all-or-nothing with dryRun. */
export const splitPayoutAct = defineService({
  name: 'acts.splitBatch',
  input: splitActInput.extend({
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) => inActorScopeAtomic(ctx, input, (tx) => splitActByActivityIn(tx, input)),
});

export const mergeActs = defineService({
  name: 'acts.merge',
  input: z.object({ firstId: z.uuid(), secondId: z.uuid() }),
  handler: async (ctx, { firstId, secondId }) =>
    inActorScope(ctx, (tx) => mergeActsIn(tx, firstId, secondId)),
});

/** The issued (not void) monthly act of a payroll item, if any: it freezes the item's money. */
export async function issuedMonthlyAct(tx: DbTransaction, itemIds: string[]) {
  if (!itemIds.length) return null;
  const [act] = await tx
    .select({ id: supplierAct.id, number: supplierAct.number })
    .from(supplierAct)
    .where(
      and(
        inArray(supplierAct.payrollItemId, itemIds),
        eq(supplierAct.type, 'monthly'),
        eq(supplierAct.status, 'issued'),
      ),
    )
    .limit(1);
  return act ?? null;
}

export const actFilters = z.object({
  payeeId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  year: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().min(2000).max(2100).optional(),
  ),
});

/**
 * Acts registry (6.6): replaces the `Реестр актов` sheet — filter by counterparty and year, totals
 * per counterparty, and months without a monthly act between a payee's first and last act (A9).
 */
export const listActs = defineService({
  name: 'acts.list',
  input: actFilters,
  handler: async (ctx, { payeeId, year }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          act: supplierAct,
          payeeName,
          contractNumber: contract.number,
        })
        .from(supplierAct)
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .where(
          and(
            payeeId ? eq(supplierAct.payeeId, payeeId) : undefined,
            year ? gte(supplierAct.actDate, `${String(year)}-01-01`) : undefined,
            year ? lt(supplierAct.actDate, `${String(year + 1)}-01-01`) : undefined,
          ),
        )
        .orderBy(asc(payeeName), desc(supplierAct.actDate)),
    );
    const byPayee = new Map<
      string,
      { payeeId: string; payeeName: string; total: string; missing: string[] }
    >();
    for (const r of rows) {
      const key = r.act.payeeId;
      if (byPayee.has(key)) continue;
      const own = rows.filter((x) => x.act.payeeId === key && x.act.status !== 'void');
      const months = new Set(
        own
          .filter((x) => x.act.type === 'monthly')
          .map((x) => (x.act.periodFrom ?? startOfMonth(x.act.actDate as LocalDate)).slice(0, 7)),
      );
      const sorted = [...months].sort();
      const missing: string[] = [];
      if (sorted.length > 1) {
        let m = `${sorted[0] ?? ''}-01` as LocalDate;
        const last = `${sorted.at(-1) ?? ''}-01`;
        while (m < last) {
          if (!months.has(m.slice(0, 7))) missing.push(m.slice(0, 7));
          m = addMonths(m, 1);
        }
      }
      byPayee.set(key, {
        payeeId: key,
        payeeName: r.payeeName,
        total: sum(
          own.filter((x) => x.act.status === 'issued').map((x) => x.act.amountUah),
        ).toFixed(2),
        missing,
      });
    }
    return ok({ acts: rows, summary: [...byPayee.values()] });
  },
});

export const getAct = defineService({
  name: 'acts.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({ act: supplierAct, payeeName, contract })
        .from(supplierAct)
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .where(eq(supplierAct.id, id)),
    );
    return row ? ok(row) : err(serviceError('not_found', 'acts.notFound'));
  },
});

/** Out-of-cycle act (reimbursement of a trip or other) with a manual date (6.6). */
export const createAct = defineService({
  name: 'acts.create',
  input: z.object({
    contractId: z.uuid({ error: 'acts.chooseContract' }),
    type: z.enum(['reimbursement', 'other']),
    actDate: localDateString,
    periodFrom: optionalLocalDate,
    periodTo: optionalLocalDate,
    amountUah: decimalString,
    dateOverrideReason: optionalText,
  }),
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const [c] = await tx.select().from(contract).where(eq(contract.id, input.contractId));
      if (!c?.payeeId || c.kind !== 'fop') {
        return err(serviceError('validation_error', 'acts.chooseFopContract'));
      }
      const [row] = await tx
        .insert(supplierAct)
        .values({ ...input, payeeId: c.payeeId })
        .returning({ id: supplierAct.id });
      return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
    }),
});

/** Draft edits: date (and amount of a non-monthly act); monthly amounts follow total_uah. */
export const saveActDraft = defineService({
  name: 'acts.saveDraft',
  input: z.object({
    id: z.uuid(),
    actDate: localDateString,
    amountUah: z.preprocess((v) => (v === '' ? undefined : v), decimalString.optional()),
    dateOverrideReason: optionalText,
  }),
  handler: async (ctx, { id, ...values }) =>
    inActorScope(ctx, async (tx) => {
      const [act] = await tx.select().from(supplierAct).where(eq(supplierAct.id, id));
      if (!act) return err(serviceError('not_found', 'acts.notFound'));
      if (act.status !== 'draft') return err(serviceError('conflict', 'acts.issuedLocked'));
      await tx
        .update(supplierAct)
        .set({
          actDate: values.actDate,
          dateOverrideReason: values.dateOverrideReason,
          ...(act.type !== 'monthly' && values.amountUah ? { amountUah: values.amountUah } : {}),
        })
        .where(eq(supplierAct.id, id));
      return ok({ id });
    }),
});

/** Issue (6.6 "як у інвойса"): number from the contract sequence, snapshot, render job. */
export const issueAct = defineService({
  name: 'acts.issue',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select({ act: supplierAct, contract, payee })
        .from(supplierAct)
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .where(eq(supplierAct.id, id))
        .for('update', { of: supplierAct });
      if (!row) return err(serviceError('not_found', 'acts.notFound'));
      if (row.act.status !== 'draft') return err(serviceError('conflict', 'acts.alreadyIssued'));
      if (!row.contract.numberSequenceKey) {
        return err(serviceError('validation_error', 'acts.noSequence'));
      }
      const [co] = await tx.select().from(company).orderBy(asc(company.createdAt)).limit(1);
      if (!co) return err(serviceError('conflict', 'company.missingShort'));
      const [numbered] = await tx.execute<{ n: string }>(
        sql`select public.issue_number(${row.contract.numberSequenceKey}, ${row.act.actDate}::date, ${row.contract.number}) as n`,
      );
      const number = numbered?.n ?? '';
      const snapshot = buildActSnapshot({
        number,
        actDate: row.act.actDate as LocalDate,
        periodFrom: row.act.periodFrom as LocalDate | null,
        periodTo: row.act.periodTo as LocalDate | null,
        amountUah: row.act.amountUah,
        company: co,
        contract: {
          number: row.contract.number,
          signedOn: row.contract.signedOn as LocalDate | null,
        },
        payee: { ...row.payee, edrDate: row.payee.edrDate as LocalDate | null },
      });
      await tx
        .update(supplierAct)
        .set({ status: 'issued', number, snapshot })
        .where(eq(supplierAct.id, id));
      await enqueueJob(tx, renderActJob(id));
      return ok({ id, number });
    }),
});

export const voidAct = defineService({
  name: 'acts.void',
  input: z.object({ id: z.uuid(), reason: requiredText('field.voidReason') }),
  handler: async (ctx, { id, reason }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(supplierAct)
        .set({ status: 'void', voidReason: reason })
        .where(and(eq(supplierAct.id, id), eq(supplierAct.status, 'issued')))
        .returning({ id: supplierAct.id }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'acts.voidState'));
  },
});

/** After signing in Vchasno the act keeps a link to the signed document (6.6). */
export const setSignedUrl = defineService({
  name: 'acts.setSignedUrl',
  input: z.object({ id: z.uuid(), signedUrl: httpUrl }),
  handler: async (ctx, { id, signedUrl }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(supplierAct)
        .set({ signedUrl })
        .where(and(eq(supplierAct.id, id), eq(supplierAct.status, 'issued')))
        .returning({ id: supplierAct.id }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'acts.linkIssuedOnly'));
  },
});

export const fopContracts = defineService({
  name: 'acts.fopContracts',
  input: z.object({}),
  handler: async (ctx) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx
          .select({ id: contract.id, number: contract.number, payeeName })
          .from(contract)
          .innerJoin(payee, eq(payee.id, contract.payeeId))
          .where(eq(contract.kind, 'fop'))
          .orderBy(asc(payeeName)),
      ),
    ),
});

/** Merging payout acts for agents (A-083): all-or-nothing with dryRun. */
export const mergePayoutActs = defineService({
  name: 'acts.mergeBatch',
  input: z.object({
    firstId: z.uuid().describe('Draft act (from get_payroll_queue acts)'),
    secondId: z.uuid().describe('The neighbouring draft act of the same payout'),
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, (tx) => mergeActsIn(tx, input.firstId, input.secondId)),
});
