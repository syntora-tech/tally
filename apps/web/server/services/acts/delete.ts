import { documentLink, supplierAct } from '@tally/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { requiredText } from '../fields';

/** Deletes only an unissued standalone mistake; numbered acts retain their audit history via voiding. */
export const deleteDraftAct = defineService({
  name: 'acts.deleteDraft',
  input: z.object({
    id: z
      .uuid()
      .describe('Exact act id from get_act; only a standalone draft without files or payout links'),
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
      if (
        act.payrollItemId ||
        act.reimbursementId ||
        act.pdfFileId ||
        act.gdocFileId ||
        act.signedUrl ||
        linked
      ) {
        return err(serviceError('conflict', 'db.referenced'));
      }
      await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);
      await tx.delete(supplierAct).where(eq(supplierAct.id, act.id));
      return ok({
        dryRun: input.dryRun,
        deleted: {
          id: act.id,
          contractId: act.contractId,
          payeeId: act.payeeId,
          actDate: act.actDate,
          periodFrom: act.periodFrom,
          periodTo: act.periodTo,
          amountUah: act.amountUah,
        },
      });
    });
  },
});
