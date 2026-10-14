import { adjustment, payrollItem, payrollLine, supplierAct } from '@tally/db/schema';
import { payrollTotalUah, payrollTotalUsd } from '@tally/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { syncMonthlyActDraft } from '../acts';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { requiredText } from '../fields';

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
      const { item } = row;
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

      await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);
      await tx.delete(payrollLine).where(eq(payrollLine.id, row.line.id));
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
      const removed = {
        lineId: row.line.id,
        amount: row.line.amount,
        currency: row.line.currency,
        itemId: item.id,
      };
      if (lines.length === 0 && adjustments.length === 0) {
        await tx.delete(supplierAct).where(eq(supplierAct.payrollItemId, item.id));
        await tx.delete(payrollItem).where(eq(payrollItem.id, item.id));
        return ok({ dryRun: input.dryRun, removed, itemDeleted: true, totalUah: null });
      }
      const totalUsd = payrollTotalUsd(lines, adjustments).toString();
      const totalUah =
        item.payoutMethod === 'fiat'
          ? payrollTotalUah(lines, adjustments, item.payoutFxRate)
          : null;
      await tx
        .update(payrollItem)
        .set({
          totalUsd,
          ...(totalUah?.isOk() && { totalUah: totalUah.value.toFixed(2) }),
        })
        .where(eq(payrollItem.id, item.id));
      await syncMonthlyActDraft(tx, item.id);
      await tx.execute(sql`select public.refresh_payroll_item(${item.id})`);
      return ok({
        dryRun: input.dryRun,
        removed,
        itemDeleted: false,
        totalUah: totalUah?.isOk() ? totalUah.value.toFixed(2) : item.totalUah,
      });
    });
  },
});
