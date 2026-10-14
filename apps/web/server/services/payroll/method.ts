import { adjustment, payrollItem, payrollLine, supplierAct } from '@tally/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { requiredText } from '../fields';

/**
 * Moves an unpaid payout to a USD method after the close (A-092): the month was closed under terms
 * that named the wrong method, and a closed month's terms cannot change. Only USD lines move — UAH
 * pay and adjustments are frozen with the period — and draft FOP acts go, as USD payouts have none.
 */
export const changePayoutMethod = defineService({
  name: 'payroll.changeMethod',
  input: z.object({
    itemId: z.uuid().describe('Payout id from get_payroll_queue'),
    payoutMethod: z
      .enum(['bank_usd', 'crypto'])
      .describe('bank_usd = USD from a USD bank account (SWIFT); crypto = USD-pegged coins'),
    reason: requiredText('field.reason').describe('Why the payout method differs from the terms'),
    dryRun: z.boolean().default(false),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    return inActorScopeAtomic(ctx, input, async (tx) => {
      const [item] = await tx
        .select()
        .from(payrollItem)
        .where(eq(payrollItem.id, input.itemId))
        .for('update');
      if (!item) return err(serviceError('not_found', 'payroll.notFound'));
      if (item.payoutMethod === input.payoutMethod) {
        return err(serviceError('conflict', 'payroll.methodSame'));
      }
      const [paid] = await tx.execute<{ paid: boolean }>(
        sql`select exists (select 1 from public.allocation a where a.payroll_item_id = ${item.id}) as paid`,
      );
      if (paid?.paid) return err(serviceError('conflict', 'payroll.methodPaid'));
      const [uah] = await tx
        .select({ id: payrollLine.id })
        .from(payrollLine)
        .where(and(eq(payrollLine.payrollItemId, item.id), ne(payrollLine.currency, 'USD')))
        .limit(1);
      if (uah) return err(serviceError('conflict', 'payroll.methodUsdOnly'));
      if (item.personId) {
        const [adj] = await tx
          .select({ id: adjustment.id })
          .from(adjustment)
          .where(
            and(
              eq(adjustment.periodId, item.periodId),
              eq(adjustment.personId, item.personId),
              eq(adjustment.payoutMethod, item.payoutMethod),
            ),
          )
          .limit(1);
        if (adj) return err(serviceError('conflict', 'payroll.methodAdjustments'));
      }
      const [taken] = await tx
        .select({ id: payrollItem.id })
        .from(payrollItem)
        .where(
          and(
            eq(payrollItem.periodId, item.periodId),
            eq(payrollItem.kind, item.kind),
            item.personId
              ? eq(payrollItem.personId, item.personId)
              : eq(payrollItem.payeeId, item.payeeId ?? ''),
            eq(payrollItem.payoutMethod, input.payoutMethod),
          ),
        )
        .limit(1);
      if (taken) return err(serviceError('conflict', 'payroll.methodTaken'));
      const acts = await tx
        .select({ id: supplierAct.id, status: supplierAct.status, number: supplierAct.number })
        .from(supplierAct)
        .where(eq(supplierAct.payrollItemId, item.id));
      const issued = acts.find((a) => a.status !== 'draft');
      if (issued) {
        return err(
          serviceError('conflict', msg('payroll.methodActIssued', { number: issued.number ?? '' })),
        );
      }

      await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);
      if (acts.length) await tx.delete(supplierAct).where(eq(supplierAct.payrollItemId, item.id));
      await tx
        .update(payrollItem)
        .set({
          payoutMethod: input.payoutMethod,
          payoutFxRate: null,
          fxSource: null,
          fxSetBy: null,
          fxSetAt: null,
          totalUah: null,
        })
        .where(eq(payrollItem.id, item.id));
      await tx.execute(sql`select public.refresh_payroll_item(${item.id})`);
      return ok({
        dryRun: input.dryRun,
        id: item.id,
        from: item.payoutMethod,
        to: input.payoutMethod,
        totalUsd: item.totalUsd,
        deletedDraftActs: acts.length,
      });
    });
  },
});
