import { contract, document, documentLink, supplierAct } from '@tally/db/schema';
import { toDecimal } from '@tally/domain';
import { eq, inArray } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { decimalString, localDateString, optionalLocalDate, requiredText } from '../fields';

const legacyAct = z.object({
  legacyRef: requiredText()
    .max(200)
    .describe(
      'Stable key of the source row, e.g. "vchasno:<documentId>"; a re-sent item is "existing"',
    ),
  contractId: z.uuid().describe('FOP contract of the act (list_contracts kind fop)'),
  number: requiredText().max(100).describe('Act number as printed'),
  actDate: localDateString,
  amountUah: decimalString.describe('Act total in UAH'),
  type: z.enum(['monthly', 'reimbursement', 'other']).default('monthly'),
  periodFrom: optionalLocalDate,
  periodTo: optionalLocalDate,
  documentIds: z
    .array(z.uuid())
    .max(10)
    .optional()
    .describe('Registry documents of this act (search_documents type act) to link'),
});

/**
 * Historical FOP acts (A-088): acts issued before Tally, entered as issued legacy rows straight
 * into the registry — no payout, snapshot or working-day check; numbers kept verbatim, even when
 * the old numbering reused one. Matched by legacyRef, so a batch can be re-sent.
 */
export const addLegacyActs = defineService({
  name: 'acts.addLegacy',
  input: z.object({
    acts: z.array(legacyAct).min(1).max(100),
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results = [];
      const contractIds = [...new Set(input.acts.map((a) => a.contractId))];
      const contracts = await tx
        .select({ id: contract.id, kind: contract.kind, payeeId: contract.payeeId })
        .from(contract)
        .where(inArray(contract.id, contractIds));
      const docIds = [...new Set(input.acts.flatMap((a) => a.documentIds ?? []))];
      const docs = docIds.length
        ? await tx.select({ id: document.id }).from(document).where(inArray(document.id, docIds))
        : [];
      const knownDocs = new Set(docs.map((d) => d.id));

      for (const [index, { documentIds, legacyRef, ...act }] of input.acts.entries()) {
        const key = `acts.${String(index)}`;
        const problems: string[] = [];
        const ct = contracts.find((c) => c.id === act.contractId);
        if (!ct?.payeeId || ct.kind !== 'fop') problems.push('acts.chooseFopContract');
        if (act.periodFrom && act.periodTo && act.periodFrom > act.periodTo) {
          problems.push('acts.legacyPeriod');
        }
        for (const id of documentIds ?? []) {
          if (!knownDocs.has(id))
            problems.push(msg('documents.targetMissing', { type: 'document', id }));
        }
        if (problems.length || !ct?.payeeId) {
          errors[key] = problems;
          continue;
        }
        const [existing] = await tx
          .select({
            id: supplierAct.id,
            contractId: supplierAct.contractId,
            number: supplierAct.number,
            actDate: supplierAct.actDate,
            amountUah: supplierAct.amountUah,
            periodFrom: supplierAct.periodFrom,
            periodTo: supplierAct.periodTo,
          })
          .from(supplierAct)
          .where(eq(supplierAct.legacyRef, legacyRef));
        let id: string;
        let status: 'created' | 'existing';
        if (existing) {
          const same =
            existing.contractId === act.contractId &&
            existing.number === act.number &&
            existing.actDate === act.actDate &&
            existing.amountUah === toDecimal(act.amountUah).toFixed(2) &&
            existing.periodFrom === act.periodFrom &&
            existing.periodTo === act.periodTo;
          if (!same) {
            errors[key] = [msg('acts.legacyChanged', { ref: legacyRef })];
            continue;
          }
          id = existing.id;
          status = 'existing';
        } else {
          const [row] = await tx
            .insert(supplierAct)
            .values({
              ...act,
              legacyRef,
              payeeId: ct.payeeId,
              isLegacy: true,
              status: 'issued',
            })
            .returning({ id: supplierAct.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          id = row.id;
          status = 'created';
        }
        const linked = documentIds?.length
          ? await tx
              .insert(documentLink)
              .values(
                [...new Set(documentIds)].map((documentId) => ({
                  documentId,
                  entityType: 'supplier_act' as const,
                  entityId: id,
                })),
              )
              .onConflictDoNothing()
              .returning({ id: documentLink.id })
          : [];
        results.push({ index, id, number: act.number, status, linkedDocuments: linked.length });
      }
      if (Object.keys(errors).length) {
        return err(
          serviceError(
            'validation_error',
            msg('batch.failedItems', { count: Object.keys(errors).length }),
            errors,
          ),
        );
      }
      return ok({ results });
    }),
});
