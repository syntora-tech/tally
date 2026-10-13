import type { Db } from '@tally/db';
import { contract, contractorInvoice, document, payee, payrollItem } from '@tally/db/schema';
import { localDateInZone, type LocalDate } from '@tally/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withSystem } from '../db/with-user';
import type { DocumentRenderer } from '../render/renderers';
import type { ContractorInvoiceSnapshot } from '../services/contractor-invoices/snapshot';
import type { ServiceContext } from '../services/context';
import { insertDocument } from '../services/documents';
import { folderPathFor } from '../storage/folders';
import type { DocumentStorage } from '../storage/types';
import type { JobHandler } from './worker';

const payloadSchema = z.object({ id: z.uuid() });

export type ContractorInvoiceRenderDeps = {
  renderer: DocumentRenderer;
  storage: DocumentStorage;
  templateId: string | undefined;
};

/** Named like the bills already filed: `Andrii Skoropupov — Invoice №16092026`. */
export const contractorInvoiceTitle = (payeeName: string, number: string) =>
  `${payeeName} — Invoice №${number}`;

/** Renders an issued contractor invoice and files it as a bill of the payee (7.1, 7.3, A-090). */
export function renderContractorInvoiceHandler(deps: ContractorInvoiceRenderDeps): JobHandler {
  return async (rawPayload: unknown, db: Db) => {
    const { id } = payloadSchema.parse(rawPayload);
    const [row] = await withSystem(db, 'system:jobs', (tx) =>
      tx
        .select({
          inv: contractorInvoice,
          templateId: contract.invoiceTemplateFileId,
          payeeName: sql<string>`coalesce(${payee.legalNameEn}, ${payee.legalNameUa})`,
          personId: payrollItem.personId,
        })
        .from(contractorInvoice)
        .innerJoin(contract, eq(contract.id, contractorInvoice.contractId))
        .innerJoin(payee, eq(payee.id, contractorInvoice.payeeId))
        .leftJoin(payrollItem, eq(payrollItem.id, contractorInvoice.payrollItemId))
        .where(eq(contractorInvoice.id, id)),
    );
    const inv = row?.inv;
    if (!row || !inv?.number || !inv.snapshot || inv.status !== 'issued' || inv.pdfFileId) {
      return { skipped: true };
    }
    const title = contractorInvoiceTitle(row.payeeName, inv.number);
    const out = await deps.renderer.render({
      layout: 'invoice_contractor',
      templateId: row.templateId ?? deps.templateId ?? null,
      folderPath: folderPathFor(
        'bill',
        { kind: 'payee', name: row.payeeName },
        inv.invoiceDate.slice(0, 4),
      ),
      fileName: title.replaceAll('/', '-'),
      snapshot: inv.snapshot as ContractorInvoiceSnapshot,
    });
    const ctx: ServiceContext = {
      actor: { kind: 'system', label: 'system:jobs' },
      today: localDateInZone(new Date()),
      db,
      config: { allowedEmails: [] },
    };
    const created = await insertDocument(ctx, deps.storage, {
      type: 'bill',
      title,
      number: inv.number,
      docDate: inv.invoiceDate as LocalDate,
      url: null,
      notes: null,
      file: new File([Buffer.from(out.file.data)], out.file.fileName, { type: out.file.mimeType }),
      links: [
        { entityType: 'payee', entityId: inv.payeeId },
        { entityType: 'contract', entityId: inv.contractId },
        ...(row.personId ? [{ entityType: 'person' as const, entityId: row.personId }] : []),
      ],
    });
    await withSystem(db, 'system:jobs', async (tx) => {
      const [doc] = await tx
        .select({ key: document.driveFileId })
        .from(document)
        .where(eq(document.id, created.id));
      await tx
        .update(contractorInvoice)
        .set({ pdfFileId: doc?.key ?? null, gdocFileId: out.sourceFileId, documentId: created.id })
        .where(and(eq(contractorInvoice.id, id), isNull(contractorInvoice.pdfFileId)));
    });
    return { documentId: created.id };
  };
}
