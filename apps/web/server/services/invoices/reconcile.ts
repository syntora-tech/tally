import { sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { currencyCode, nonNegativeDecimal, requiredText } from '../fields';

type Correction = {
  id: string;
  oldNumber: string;
  number: string;
  signedDocumentId: string;
  revision: number;
};

export const reconcileInvoiceNumbers = defineService({
  name: 'invoices.reconcileNumbers',
  input: z.object({
    invoices: z
      .array(
        z.object({
          invoiceId: z.uuid(),
          signedDocumentId: z
            .uuid()
            .describe(
              'Current attached signed invoice copy, verified with get_document(includeContent: true)',
            ),
          expectedNumber: requiredText()
            .max(100)
            .describe('Current invoice number, for concurrency protection'),
          number: requiredText()
            .max(100)
            .describe('Exact number in the signed PDF, including any revision suffix'),
          signedTotal: nonNegativeDecimal.describe(
            'Total verified in signed PDF, as a decimal string',
          ),
          signedCurrency: currencyCode.describe('Currency verified in signed PDF'),
        }),
      )
      .min(1)
      .max(50),
    reason: requiredText().describe('Why signed originals override system numbers'),
    dryRun: z.boolean().default(false),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    return inActorScopeAtomic(ctx, input, async (tx) => {
      const rows = await tx.execute<{ corrections: Correction[] }>(sql`
        select public.reconcile_invoice_numbers(${JSON.stringify(input.invoices)}::jsonb, ${input.reason}) as corrections
      `);
      return ok({ dryRun: input.dryRun, invoices: rows[0]?.corrections ?? [] });
    });
  },
});
