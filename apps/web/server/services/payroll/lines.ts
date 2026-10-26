import type { DbTransaction } from '@tally/db';
import { adjustment, payrollItem, payrollLine, period, supplierAct } from '@tally/db/schema';
import { payrollTotalUah, payrollTotalUsd, toDecimal } from '@tally/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { syncMonthlyActDraft } from '../acts';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { currencyCode, decimalString, requiredText } from '../fields';

/**
 * Takes a line out of an unpaid payout of a closed month (A-097): a director's salary is paid
 * through planned payments, so it must not sit in the FOP payout and its act. The payout's totals
 * and its draft act follow; a payout left empty goes. Owner only, with a reason.
 */
export const removePayoutLine = defineService({
  name: 'payroll.removeLine',
  input: z.object({
    lineId: z.uuid().describe('Payout line id from get_payroll_queue (lines[].id)'),
    reason: requiredText('field.reason').describe('Why the line does not belong to the payout'),
    dryRun: z.boolean().default(false),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    return inActorScopeAtomic(ctx, input, async (tx) => {
      const [row] = await tx
        .select({ line: payrollLine, item: payrollItem })
        .from(payrollLine)
        .innerJoin(payrollItem, eq(payrollItem.id, payrollLine.payrollItemId))
        .where(eq(payrollLine.id, input.lineId))
        .for('update', { of: payrollItem });
      if (!row) return err(serviceError('not_found', 'payroll.lineNotFound'));
      const open = await openToOwner(tx, row.item.id);
      if (open.isErr()) return err(open.error);
      const item = open.value;

      await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);
      await tx.delete(payrollLine).where(eq(payrollLine.id, row.line.id));
      const removed = {
        lineId: row.line.id,
        amount: row.line.amount,
        currency: row.line.currency,
        itemId: item.id,
      };
      const totals = await recomputePayout(tx, item);
      return ok({ dryRun: input.dryRun, removed, ...totals });
    });
  },
});

/** Totals of a payout after its lines or adjustments changed; its draft act follows (A-097). */
export async function recomputePayout(tx: DbTransaction, item: typeof payrollItem.$inferSelect) {
  const lines = await tx
    .select({ amount: payrollLine.amount, currency: payrollLine.currency })
    .from(payrollLine)
    .where(eq(payrollLine.payrollItemId, item.id));
  const adjustments = item.personId
    ? await tx
        .select({ amount: adjustment.amount, currency: adjustment.currency })
        .from(adjustment)
        .where(
          and(
            eq(adjustment.periodId, item.periodId),
            eq(adjustment.personId, item.personId),
            eq(adjustment.payoutMethod, item.payoutMethod),
          ),
        )
    : [];
  if (lines.length === 0 && adjustments.length === 0) {
    await tx.delete(supplierAct).where(eq(supplierAct.payrollItemId, item.id));
    await tx.delete(payrollItem).where(eq(payrollItem.id, item.id));
    return { itemDeleted: true, totalUsd: null, totalUah: null };
  }
  const totalUsd = payrollTotalUsd(lines, adjustments).toString();
  const totalUah =
    item.payoutMethod === 'fiat' ? payrollTotalUah(lines, adjustments, item.payoutFxRate) : null;
  await tx
    .update(payrollItem)
    .set({
      totalUsd,
      ...(totalUah?.isOk() && { totalUah: totalUah.value.toFixed(2) }),
    })
    .where(eq(payrollItem.id, item.id));
  await syncMonthlyActDraft(tx, item.id);
  await tx.execute(sql`select public.refresh_payroll_item(${item.id})`);
  return {
    itemDeleted: false,
    totalUsd,
    totalUah: totalUah?.isOk() ? totalUah.value.toFixed(2) : item.totalUah,
  };
}

/** An unpaid payout of a closed month whose act is not issued: the owner's exceptions (A-097). */
export async function openToOwner(tx: DbTransaction, itemId: string) {
  const [item] = await tx
    .select()
    .from(payrollItem)
    .where(eq(payrollItem.id, itemId))
    .for('update');
  if (!item) return err(serviceError('not_found', 'payroll.notFound'));
  const [paid] = await tx.execute<{ paid: boolean }>(
    sql`select exists (select 1 from public.allocation a where a.payroll_item_id = ${item.id}) as paid`,
  );
  if (paid?.paid) return err(serviceError('conflict', 'payroll.lineItemPaid'));
  const [issued] = await tx
    .select({ number: supplierAct.number })
    .from(supplierAct)
    .where(and(eq(supplierAct.payrollItemId, item.id), ne(supplierAct.status, 'draft')))
    .limit(1);
  if (issued) return err(serviceError('conflict', 'payroll.lineActIssued'));
  return ok(item);
}

/**
 * Adds an adjustment to an unpaid payout of a closed month (A-099), e.g. a correction of a few
 * cents of an internal line: the month's adjustments are frozen otherwise. The payout's totals and
 * its draft act follow. Owner only, with a reason.
 */
export const adjustClosedPayout = defineService({
  name: 'payroll.adjustClosed',
  input: z.object({
    itemId: z.uuid().describe('Payout id from get_payroll_queue'),
    kind: z
      .enum(['bonus', 'deduction', 'correction', 'other'])
      .default('correction')
      .describe('correction by default; deduction makes the amount negative'),
    amount: decimalString
      .refine((v) => !toDecimal(v).isZero(), 'field.nonZero')
      .describe('Signed decimal, e.g. "-0.27" to bring 804 USD down to 803.73'),
    currency: currencyCode
      .refine((c) => ['USD', 'USDT', 'USDC', 'UAH'].includes(c), 'periods.adjustmentCurrency')
      .default('USD'),
    reason: requiredText('field.reason').describe('Why the payout changes after the close'),
    actId: z
      .preprocess((v) => (v === '' ? undefined : v), z.uuid().optional())
      .describe(
        'Draft act of the payout (acts[].id) the adjustment goes into; default the act of the rest (A-100)',
      ),
    dryRun: z.boolean().default(false),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    return inActorScopeAtomic(ctx, input, async (tx) => {
      const open = await openToOwner(tx, input.itemId);
      if (open.isErr()) return err(open.error);
      const item = open.value;
      if (!item.personId) return err(serviceError('validation_error', 'payroll.adjustPersonOnly'));
      const [month] = await tx.select().from(period).where(eq(period.id, item.periodId));
      if (month?.status !== 'closed') {
        return err(serviceError('conflict', 'payroll.adjustOpenPeriod'));
      }
      const [act] = input.actId
        ? await tx.select().from(supplierAct).where(eq(supplierAct.id, input.actId))
        : [];
      if (
        input.actId &&
        (act?.payrollItemId !== item.id || act.status !== 'draft' || act.rateLocked)
      ) {
        return err(serviceError('validation_error', 'payroll.adjustActDraft'));
      }
      await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);
      const amount =
        input.kind === 'deduction' ? toDecimal(input.amount).abs().neg().toString() : input.amount;
      const [added] = await tx
        .insert(adjustment)
        .values({
          periodId: item.periodId,
          personId: item.personId,
          payoutMethod: item.payoutMethod,
          kind: input.kind,
          amount,
          currency: input.currency,
          reason: input.reason,
          // The act of the rest takes the adjustments given to no other act (A-085).
          supplierActId: act && act.amountUsd !== null ? act.id : null,
        })
        .returning({ id: adjustment.id });
      const totals = await recomputePayout(tx, item);
      return ok({
        dryRun: input.dryRun,
        adjustmentId: added?.id ?? null,
        itemId: item.id,
        ...totals,
      });
    });
  },
});
