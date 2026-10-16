import type { DbTransaction } from '@tally/db';
import {
  documentLink,
  payrollItem,
  reimbursement,
  supplierAct,
  type SupplierAct,
} from '@tally/db/schema';
import { addDays, startOfMonth, toDecimal, type LocalDate } from '@tally/domain';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { requiredText } from '../fields';
import { actsOfMonth, syncEarlyActsOf } from '../periods/early';
import { mergeActsIn, monthlyActsOf, syncMonthlyActDraft } from '.';

/** Other monthly acts sharing the act's month: of its payout, or of the person before the close. */
async function siblingsOf(tx: DbTransaction, act: SupplierAct) {
  const all = act.payrollItemId
    ? await monthlyActsOf(tx, act.payrollItemId)
    : await tx
        .select()
        .from(supplierAct)
        .where(
          and(
            eq(supplierAct.payeeId, act.payeeId),
            actsOfMonth(startOfMonth((act.periodFrom ?? act.actDate) as LocalDate)),
            isNull(supplierAct.payrollItemId),
            ne(supplierAct.status, 'void'),
          ),
        );
  return all.filter((a) => a.id !== act.id);
}

/** A draft neighbour the act's days and work can go back to — the act of the rest first. */
function neighbourOf(act: SupplierAct, siblings: readonly SupplierAct[]) {
  const touches = (a: SupplierAct) =>
    a.status === 'draft' &&
    !!act.periodFrom &&
    !!act.periodTo &&
    ((!!a.periodTo && addDays(a.periodTo as LocalDate, 1) === act.periodFrom) ||
      (!!a.periodFrom && addDays(act.periodTo as LocalDate, 1) === a.periodFrom));
  const near = siblings.filter(touches);
  return near.find((a) => a.amountUsd === null) ?? near[0] ?? null;
}

/**
 * Deletes an unnumbered draft act (A-091). A standalone draft, or a person's only act of a month
 * before the close, is removed; an act split off a month gives its days and work back to the
 * neighbouring draft it touches (as a merge); the only act of a payout stays — the payout needs
 * one. Issued acts are voided instead, so their numbers stay reserved.
 */
export const deleteDraftAct = defineService({
  name: 'acts.deleteDraft',
  input: z.object({
    id: z
      .uuid()
      .describe(
        'Exact act id from get_act: an unnumbered draft without files, document links or a paid part',
      ),
    reason: requiredText().describe('Owner-provided reason for deleting the mistaken draft'),
    dryRun: z.boolean().default(false),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    return inActorScopeAtomic(ctx, input, async (tx) => {
      const [permission] = await tx.execute<{ role: string }>(
        sql`select public.current_app_role() as role`,
      );
      if (permission?.role !== 'owner') return err(serviceError('forbidden', 'general.forbidden'));
      const [act] = await tx
        .select()
        .from(supplierAct)
        .where(eq(supplierAct.id, input.id))
        .for('update');
      if (!act) return err(serviceError('not_found', 'acts.notFound'));
      if (act.status !== 'draft' || act.number !== null) {
        return err(serviceError('conflict', 'acts.issuedLocked'));
      }
      const [linked] = await tx
        .select({ id: documentLink.id })
        .from(documentLink)
        .where(and(eq(documentLink.entityType, 'supplier_act'), eq(documentLink.entityId, act.id)))
        .limit(1);
      const [paysTrip] = await tx
        .select({ id: reimbursement.id })
        .from(reimbursement)
        .where(eq(reimbursement.supplierActId, act.id))
        .limit(1);
      if (paysTrip || act.pdfFileId || act.gdocFileId || act.signedUrl || linked) {
        return err(serviceError('conflict', 'db.referenced'));
      }
      if (act.rateLocked) return err(serviceError('conflict', 'acts.deletePaidPart'));
      const deleted = {
        id: act.id,
        contractId: act.contractId,
        payeeId: act.payeeId,
        actDate: act.actDate,
        periodFrom: act.periodFrom,
        periodTo: act.periodTo,
        amountUah: act.amountUah,
      };
      await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);

      const siblings = act.type === 'monthly' ? await siblingsOf(tx, act) : [];
      if (siblings.length === 0) {
        if (act.payrollItemId) {
          // The only act of an unpaid payout may go (A-109): a fresh draft comes back from the
          // current contract with the next rate approval or payment. A paid payout keeps its act.
          const [item] = await tx
            .select({ paid: payrollItem.paidAmount })
            .from(payrollItem)
            .where(eq(payrollItem.id, act.payrollItemId));
          if (item && toDecimal(item.paid).gt(0)) {
            return err(serviceError('conflict', 'acts.deleteOnlyPayoutAct'));
          }
        }
        await tx.delete(supplierAct).where(eq(supplierAct.id, act.id));
        return ok({ dryRun: input.dryRun, deleted, mergedInto: null as string | null });
      }
      const neighbour = neighbourOf(act, siblings);
      if (!neighbour) return err(serviceError('conflict', 'acts.deleteNoNeighbour'));
      if (neighbour.amountUsd === null) {
        // The act of the rest takes back the days; its work goes to the rest as nobody else's.
        const later = (neighbour.periodFrom ?? '') > (act.periodFrom ?? '');
        await tx.delete(supplierAct).where(eq(supplierAct.id, act.id));
        await tx
          .update(supplierAct)
          .set({
            periodFrom: later ? act.periodFrom : neighbour.periodFrom,
            periodTo: later ? neighbour.periodTo : act.periodTo,
            actDate: later ? neighbour.actDate : act.actDate,
          })
          .where(eq(supplierAct.id, neighbour.id));
        if (act.payrollItemId) await syncMonthlyActDraft(tx, act.payrollItemId);
        else await syncEarlyActsOf(tx, act.payeeId, startOfMonth(act.periodFrom as LocalDate));
        return ok({ dryRun: input.dryRun, deleted, mergedInto: neighbour.id });
      }
      const merged = await mergeActsIn(tx, neighbour.id, act.id);
      if (merged.isErr()) return err(merged.error);
      // The merge keeps the earlier act's row; either way the result carries the act that stays.
      return ok({ dryRun: input.dryRun, deleted, mergedInto: merged.value.id });
    });
  },
});
