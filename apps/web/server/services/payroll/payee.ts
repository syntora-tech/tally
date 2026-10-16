import { contract, payee, payrollItem, person, supplierAct } from '@tally/db/schema';
import { and, eq, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { ensureMonthlyActDraft, syncMonthlyActDraft } from '../acts';

/**
 * The legal recipient of a payout chosen after the close (A-113): a person without a default
 * payee had none at the close, so a fiat payout had no FOP act. Only an unpaid payout without
 * acts changes; a FOP with a contract gets its draft act at once. "Remember" makes the payee the
 * person's default for the next months.
 */
export const setPayoutPayee = defineService({
  name: 'payroll.setPayee',
  input: z.object({
    itemId: z.uuid(),
    payeeId: z.uuid({ error: 'payroll.choosePayee' }),
    remember: z.preprocess((v) => v === 'on' || v === true, z.boolean()).default(false),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role === 'viewer') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    return inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
      const [item] = await tx
        .select()
        .from(payrollItem)
        .where(eq(payrollItem.id, input.itemId))
        .for('update');
      if (!item) return err(serviceError('not_found', 'payroll.notFound'));
      if (item.kind !== 'person' || !item.personId) {
        return err(serviceError('conflict', 'payroll.payeeAgency'));
      }
      const [paid] = await tx.execute<{ paid: boolean }>(
        sql`select exists (select 1 from public.allocation a where a.payroll_item_id = ${item.id}) as paid`,
      );
      if (paid?.paid) return err(serviceError('conflict', 'payroll.payeePaid'));
      const [act] = await tx
        .select({ id: supplierAct.id })
        .from(supplierAct)
        .where(and(eq(supplierAct.payrollItemId, item.id), ne(supplierAct.status, 'void')))
        .limit(1);
      if (act) return err(serviceError('conflict', 'payroll.payeeHasAct'));
      const [chosen] = await tx.select().from(payee).where(eq(payee.id, input.payeeId));
      if (!chosen) return err(serviceError('not_found', 'payroll.choosePayee'));
      if (chosen.kind === 'fop' && item.payoutMethod === 'fiat') {
        const [fop] = await tx
          .select({ id: contract.id })
          .from(contract)
          .where(and(eq(contract.payeeId, chosen.id), eq(contract.kind, 'fop')))
          .limit(1);
        if (!fop) return err(serviceError('validation_error', 'payroll.payeeNoContract'));
      }
      await tx.update(payrollItem).set({ payeeId: chosen.id }).where(eq(payrollItem.id, item.id));
      if (input.remember) {
        await tx
          .update(person)
          .set({ defaultPayeeId: chosen.id })
          .where(eq(person.id, item.personId));
      }
      const draft = await ensureMonthlyActDraft(tx, item.id);
      if (draft) await syncMonthlyActDraft(tx, item.id);
      return ok({ id: item.id, actId: draft?.id ?? null });
    });
  },
});
