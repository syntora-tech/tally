import 'server-only';
import { contractorInvoice, payee, payrollItem } from '@tally/db/schema';
import type { LocalDate } from '@tally/domain';
import { eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { getDocumentStorage } from '../../storage';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { insertDocument, optionalFile } from '../documents';
import { serviceError } from '../errors';
import { optionalHttpUrl } from '../fields';

/**
 * Marks an issued contractor invoice signed by both sides (A-096): a link (DocuSign) and/or the
 * signed PDF, filed as a bill of the payee. A signed invoice lets its payout be paid.
 */
export const signContractorInvoice = defineService({
  name: 'contractorInvoices.sign',
  input: z
    .object({ id: z.uuid(), signedUrl: optionalHttpUrl, file: optionalFile })
    .refine((v) => !!v.signedUrl || v.file !== undefined, {
      message: 'contractorInvoices.signedWhat',
      path: ['signedUrl'],
    }),
  handler: async (ctx, { id, signedUrl, file }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({
          inv: contractorInvoice,
          payeeName: sql<string>`coalesce(${payee.legalNameEn}, ${payee.legalNameUa})`,
          personId: payrollItem.personId,
        })
        .from(contractorInvoice)
        .innerJoin(payee, eq(payee.id, contractorInvoice.payeeId))
        .leftJoin(payrollItem, eq(payrollItem.id, contractorInvoice.payrollItemId))
        .where(eq(contractorInvoice.id, id)),
    );
    if (!row || row.inv.status !== 'issued' || !row.inv.number) {
      return err(serviceError('conflict', 'contractorInvoices.signIssuedOnly'));
    }
    const { inv } = row;
    const signed = file
      ? await insertDocument(ctx, getDocumentStorage(), {
          type: 'bill',
          title: `${row.payeeName} — Invoice №${inv.number} (signed)`,
          number: inv.number,
          docDate: inv.invoiceDate as LocalDate,
          url: signedUrl ?? null,
          notes: null,
          file,
          links: [
            { entityType: 'payee', entityId: inv.payeeId },
            { entityType: 'contract', entityId: inv.contractId },
            ...(row.personId ? [{ entityType: 'person' as const, entityId: row.personId }] : []),
          ],
          signedAt: new Date(),
        })
      : null;
    await inActorScope(ctx, (tx) =>
      tx
        .update(contractorInvoice)
        .set({
          signedAt: new Date(),
          ...(signedUrl && { signedUrl }),
          ...(signed && { signedDocumentId: signed.id }),
        })
        .where(eq(contractorInvoice.id, id)),
    );
    return ok({ id, signedDocumentId: signed?.id ?? null });
  },
});
