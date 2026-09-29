import type { Db } from '@tally/db';
import { client, contract, document, invoice, invoiceLine } from '@tally/db/schema';
import { localDateInZone, toDecimal, type LocalDate } from '@tally/domain';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { InvoiceLayout, DocumentRenderer } from '../render/renderers';
import { withSystem } from '../db/with-user';
import type { ServiceContext } from '../services/context';
import { insertDocument } from '../services/documents';
import { currentInvoiceDocument } from '../services/invoices';
import type { InvoiceSnapshot } from '../services/invoices/snapshot';
import { folderPathFor } from '../storage/folders';
import type { DocumentStorage } from '../storage/types';
import type { JobHandler } from './worker';

const payloadSchema = z.object({ invoiceId: z.uuid(), revision: z.number().int().min(1) });

export type RenderDeps = {
  renderer: DocumentRenderer;
  storage: DocumentStorage;
  templates: Partial<Record<InvoiceLayout, string>>;
};

/** Fixed-fee invoices (every line a single unit) use the table without hours and rates (7.2). */
export function invoiceLayout(quantities: readonly string[]): InvoiceLayout {
  return quantities.every((q) => toDecimal(q).eq(1)) ? 'invoice_fixed' : 'invoice_hourly';
}

/** File name as in spec 7.3: `Invoice 25-26 Boosty 2026-10-01`. */
export function invoiceFileName(number: string, clientName: string, issueDate: string): string {
  return `Invoice ${number.replaceAll('/', '-')} ${clientName} ${issueDate}`;
}

/**
 * Renders the frozen snapshot of an issued invoice revision (7.1) and files the result as the
 * invoice's current document. Stale jobs (older revision, already rendered, void) are no-ops.
 */
export function renderInvoiceHandler(deps: RenderDeps): JobHandler {
  return async (rawPayload: unknown, db: Db) => {
    const { invoiceId, revision } = payloadSchema.parse(rawPayload);
    const loaded = await withSystem(db, 'system:jobs', async (tx) => {
      const [row] = await tx
        .select({
          invoice,
          templateId: contract.invoiceTemplateFileId,
          clientName: client.shortName,
          legalName: client.legalName,
        })
        .from(invoice)
        .innerJoin(contract, eq(contract.id, invoice.contractId))
        .innerJoin(client, eq(client.id, invoice.clientId))
        .where(eq(invoice.id, invoiceId));
      if (!row) return null;
      const lines = await tx
        .select({ quantity: invoiceLine.quantity })
        .from(invoiceLine)
        .where(eq(invoiceLine.invoiceId, invoiceId));
      return { ...row, lines, current: await currentInvoiceDocument(tx, invoiceId) };
    });
    const inv = loaded?.invoice;
    if (!loaded || !inv?.number || !inv.snapshot) return { skipped: 'not issued' };
    if (inv.status === 'void' || inv.revision !== revision || inv.pdfFileId) {
      return { skipped: 'outdated' };
    }

    const clientName = loaded.clientName ?? loaded.legalName;
    const layout = invoiceLayout(loaded.lines.map((l) => l.quantity));
    const fileName = invoiceFileName(inv.number, clientName, inv.issueDate);
    const out = await deps.renderer.render({
      layout,
      templateId: loaded.templateId ?? deps.templates[layout] ?? null,
      folderPath: folderPathFor(
        'invoice',
        { kind: 'client', name: clientName },
        inv.issueDate.slice(0, 4),
      ),
      fileName,
      snapshot: inv.snapshot as InvoiceSnapshot,
    });

    const ctx: ServiceContext = {
      actor: { kind: 'system', label: 'system:jobs' },
      today: localDateInZone(new Date()),
      db,
      config: { allowedEmails: [] },
    };
    const created = await insertDocument(ctx, deps.storage, {
      type: 'invoice',
      title: fileName,
      number: inv.number,
      docDate: inv.issueDate as LocalDate,
      url: null,
      notes: null,
      file: new File([Buffer.from(out.file.data)], out.file.fileName, { type: out.file.mimeType }),
      links: [
        { entityType: 'client', entityId: inv.clientId },
        { entityType: 'invoice', entityId: inv.id },
      ],
      sourceRevision: revision,
      ...(loaded.current ? { supersedes: loaded.current } : {}),
    });

    await withSystem(db, 'system:jobs', async (tx) => {
      const [doc] = await tx
        .select({ key: document.driveFileId })
        .from(document)
        .where(eq(document.id, created.id));
      await tx
        .update(invoice)
        .set({ pdfFileId: doc?.key ?? null, gdocFileId: out.sourceFileId })
        .where(
          and(eq(invoice.id, invoiceId), eq(invoice.revision, revision), isNull(invoice.pdfFileId)),
        );
    });
    return { documentId: created.id };
  };
}
