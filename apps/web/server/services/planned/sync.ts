import type { Db, DbTransaction } from '@tally/db';
import {
  paymentCharge,
  plannedExpense,
  plannedExpensePart,
  plannedPayment,
  type PaymentCharge,
  type PlannedExpense,
  type PlannedExpensePart,
  type PlannedPayment,
} from '@tally/db/schema';
import {
  addMonths,
  convertVia,
  plannedMonthPayments,
  startOfMonth,
  type ChargeAmount,
  type Convert,
  type LocalDate,
  type PlannedCharge,
  type PlannedExpenseRule,
  type PlannedInstalment,
  type PlannedPart,
} from '@tally/domain';
import { and, asc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { withSystem } from '../../db/with-user';
import { loadUsdConverter } from '../fx';

/** Months kept as payments around today: the last one (its rest is due now), this and the next. */
const MONTHS_BACK = 1;
const MONTHS_AHEAD = 1;

export const ruleOf = (e: PlannedExpense): PlannedExpenseRule => ({
  ...e,
  startsOn: e.startsOn as LocalDate,
  endsOn: e.endsOn as LocalDate | null,
});

export const partOf = (p: PlannedExpensePart): PlannedPart => p;

export const chargeOf = (c: PaymentCharge): PlannedCharge => ({
  ...c,
  startsOn: c.startsOn as LocalDate,
  endsOn: c.endsOn as LocalDate | null,
});

const n = (v: { toFixed: (dp: number) => string } | null | undefined, dp = 2) =>
  v ? v.toFixed(dp) : null;

type Key = string;
const keyOf = (partId: string | null, chargeId: string | null, month: string): Key =>
  `${partId ?? '-'}|${chargeId ?? '-'}|${month}`;

/** A row the rules may still rewrite: unpaid, not skipped, not set by hand, not in the past. */
const rewritable = (p: PlannedPayment, current: LocalDate) =>
  p.status === 'due' && !p.amountOverridden && p.month >= current;

function baseValues(e: PlannedExpense, i: PlannedInstalment) {
  return {
    dueOn: i.dueOn,
    name: i.name,
    categoryId: e.categoryId,
    counterparty: e.counterparty,
    personId: e.personId,
    gross: n(i.gross, 8),
    amount: i.net.toFixed(2),
    currency: i.currency,
    feeAmount: n(i.fee?.amount),
    feeCurrency: i.fee?.currency ?? null,
  };
}

function chargeValues(
  c: PaymentCharge,
  a: ChargeAmount,
  base: { dueOn: string; gross: string | null },
) {
  return {
    dueOn: base.dueOn,
    name: c.name,
    categoryId: c.categoryId,
    counterparty: c.counterparty,
    personId: null,
    gross: base.gross,
    amount: a.amount.toFixed(2),
    currency: a.currency,
    feeAmount: n(a.fee?.amount),
    feeCurrency: a.fee?.currency ?? null,
  };
}

/**
 * Brings `planned_payment` rows of the given rules (or all) in line with the rules for the months
 * around today (A-082): missing payments are created; unpaid ones of this month on are rewritten,
 * or removed when the rule no longer has them. Paid, skipped and hand-set rows stay as they are.
 */
export async function syncPlannedPayments(
  tx: DbTransaction,
  today: LocalDate,
  ruleIds?: readonly string[],
  convert?: Convert,
) {
  const current = startOfMonth(today);
  const months = Array.from({ length: MONTHS_BACK + MONTHS_AHEAD + 1 }, (_, i) =>
    addMonths(current, i - MONTHS_BACK),
  );
  const rules = await tx
    .select()
    .from(plannedExpense)
    .where(ruleIds ? inArray(plannedExpense.id, [...ruleIds]) : undefined);
  if (rules.length === 0) return { created: 0, updated: 0, removed: 0 };
  const ids = rules.map((r) => r.id);
  const [parts, charges, existing] = await Promise.all([
    tx
      .select()
      .from(plannedExpensePart)
      .where(inArray(plannedExpensePart.plannedExpenseId, ids))
      .orderBy(asc(plannedExpensePart.sort), asc(plannedExpensePart.dueDay)),
    tx.select().from(paymentCharge).where(inArray(paymentCharge.plannedExpenseId, ids)),
    tx
      .select()
      .from(plannedPayment)
      .where(
        and(
          inArray(plannedPayment.plannedExpenseId, ids),
          gte(plannedPayment.month, months[0] ?? current),
        ),
      ),
  ]);
  const toConvert = convert ?? convertVia(await loadUsdConverter(tx));
  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const rule of rules) {
    const own = existing.filter((p) => p.plannedExpenseId === rule.id);
    const byKey = new Map(own.map((p) => [keyOf(p.partId, p.chargeId, p.month), p]));
    const ruleParts = parts.filter((p) => p.plannedExpenseId === rule.id);
    const ruleCharges = charges.filter((c) => c.plannedExpenseId === rule.id);
    const wanted = new Set<Key>();

    for (const month of months) {
      const instalments = plannedMonthPayments(
        ruleOf(rule),
        ruleParts.map(partOf),
        ruleCharges.map(chargeOf),
        month,
        toConvert,
      );
      for (const i of instalments) {
        const baseKey = keyOf(i.partId, null, month);
        wanted.add(baseKey);
        let base = byKey.get(baseKey);
        if (!base) {
          [base] = await tx
            .insert(plannedPayment)
            .values({ plannedExpenseId: rule.id, partId: i.partId, month, ...baseValues(rule, i) })
            .returning();
          created++;
        } else if (rewritable(base, current)) {
          await tx
            .update(plannedPayment)
            .set(baseValues(rule, i))
            .where(eq(plannedPayment.id, base.id));
          updated++;
        }
        if (!base || base.status === 'skipped') continue;
        // Charges of a hand-set instalment follow its gross, recomputed when it is set.
        if (base.amountOverridden) {
          for (const c of i.charges) wanted.add(keyOf(i.partId, c.chargeId, month));
          continue;
        }
        const gross = n(i.gross, 8);
        for (const a of i.charges) {
          const charge = ruleCharges.find((c) => c.id === a.chargeId);
          if (!charge) continue;
          const key = keyOf(i.partId, a.chargeId, month);
          wanted.add(key);
          const row = byKey.get(key);
          const values = chargeValues(charge, a, { dueOn: i.dueOn, gross });
          if (!row) {
            await tx.insert(plannedPayment).values({
              plannedExpenseId: rule.id,
              partId: i.partId,
              chargeId: a.chargeId,
              parentId: base.id,
              month,
              ...values,
            });
            created++;
          } else if (rewritable(row, current)) {
            await tx.update(plannedPayment).set(values).where(eq(plannedPayment.id, row.id));
            updated++;
          }
        }
      }
    }

    // Charges first: a base row takes its unpaid charges along, but never a paid one.
    const stale = own
      .filter((p) => !wanted.has(keyOf(p.partId, p.chargeId, p.month)) && rewritable(p, current))
      .sort((a, b) => Number(a.chargeId === null) - Number(b.chargeId === null));
    for (const p of stale) {
      const paidChild = own.some((c) => c.parentId === p.id && c.status === 'paid');
      if (paidChild) continue;
      await tx.delete(plannedPayment).where(eq(plannedPayment.id, p.id));
      removed++;
    }
  }
  return { created, updated, removed };
}

/** Recomputes the charges of an instalment whose gross was set by hand (A-082). */
export async function syncChargesOfInstalment(
  tx: DbTransaction,
  base: PlannedPayment,
  convert: Convert,
) {
  if (!base.plannedExpenseId || base.chargeId) return;
  const charges = await tx
    .select()
    .from(paymentCharge)
    .where(eq(paymentCharge.plannedExpenseId, base.plannedExpenseId));
  const [rule] = await tx
    .select()
    .from(plannedExpense)
    .where(eq(plannedExpense.id, base.plannedExpenseId));
  if (!rule) return;
  const rows = await tx
    .select()
    .from(plannedPayment)
    .where(and(eq(plannedPayment.parentId, base.id), isNotNull(plannedPayment.chargeId)));
  const instalment = plannedMonthPayments(
    {
      ...ruleOf(rule),
      amount: base.gross ?? base.amount,
      frequency: 'monthly',
      startsOn: base.month as LocalDate,
      endsOn: null,
    },
    [],
    charges.map(chargeOf),
    base.month as LocalDate,
    convert,
  )[0];
  if (!instalment) return;
  for (const a of instalment.charges) {
    const charge = charges.find((c) => c.id === a.chargeId);
    if (!charge) continue;
    const row = rows.find((r) => r.chargeId === a.chargeId);
    const values = chargeValues(charge, a, { dueOn: base.dueOn, gross: base.gross });
    if (!row) {
      await tx.insert(plannedPayment).values({
        plannedExpenseId: base.plannedExpenseId,
        partId: base.partId,
        chargeId: a.chargeId,
        parentId: base.id,
        month: base.month,
        ...values,
      });
    } else if (row.status === 'due' && !row.amountOverridden) {
      await tx.update(plannedPayment).set(values).where(eq(plannedPayment.id, row.id));
    }
  }
  return instalment;
}

/** Daily run (with the `payability` cron): next month's payments appear on time (A-082). */
export function syncAllPlannedPayments(db: Db, today: LocalDate) {
  return withSystem(db, 'system:planned', (tx) => syncPlannedPayments(tx, today));
}
