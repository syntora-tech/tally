import type { Db } from '@tally/db';
import { contract, document, payee, supplierAct } from '@tally/db/schema';
import { localDateInZone, type LocalDate } from '@tally/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withSystem } from '../db/with-user';
import type { DocumentRenderer } from '../render/renderers';
import type { ActSnapshot } from '../services/acts/snapshot';
import type { ServiceContext } from '../services/context';
import { insertDocument } from '../services/documents';
import { folderPathFor } from '../storage/folders';
import type { DocumentStorage } from '../storage/types';
import type { JobHandler } from './worker';

const payloadSchema = z.object({ actId: z.uuid() });

export type ActRenderDeps = {
  renderer: DocumentRenderer;
  storage: DocumentStorage;
  templateId: string | undefined;
};

/** Act file named like the registry: `Акт 1002 - А9 2026-08-31`. */
export const actFileName = (number: string, actDate: string) =>
  `Акт ${number.replaceAll('/', '-')} ${actDate}`;

/** Renders an issued act from its snapshot and files it under the payee (7.1, 7.3). */
export function renderActHandler(deps: ActRenderDeps): JobHandler {
  return async (rawPayload: unknown, db: Db) => {
    const { actId } = payloadSchema.parse(rawPayload);
    const [row] = await withSystem(db, 'system:jobs', (tx) =>
      tx
        .select({
          act: supplierAct,
          templateId: contract.actTemplateFileId,
          payeeName: sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`,
        })
        .from(supplierAct)
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .where(eq(supplierAct.id, actId)),
    );
    const act = row?.act;
    if (!row || !act?.number || !act.snapshot || act.status !== 'issued' || act.pdfFileId) {
      return { skipped: true };
    }
    const fileName = actFileName(act.number, act.actDate);
    const out = await deps.renderer.render({
      layout: 'act_fop',
      templateId: row.templateId ?? deps.templateId ?? null,
      folderPath: folderPathFor(
        'act',
        { kind: 'payee', name: row.payeeName },
        act.actDate.slice(0, 4),
      ),
      fileName,
      snapshot: act.snapshot as ActSnapshot,
    });
    const ctx: ServiceContext = {
      actor: { kind: 'system', label: 'system:jobs' },
      today: localDateInZone(new Date()),
      db,
      config: { allowedEmails: [] },
    };
    const created = await insertDocument(ctx, deps.storage, {
      type: 'act',
      title: fileName,
      number: act.number,
      docDate: act.actDate as LocalDate,
      url: null,
      notes: null,
      file: new File([Buffer.from(out.file.data)], out.file.fileName, { type: out.file.mimeType }),
      links: [
        { entityType: 'payee', entityId: act.payeeId },
        { entityType: 'supplier_act', entityId: act.id },
      ],
    });
    await withSystem(db, 'system:jobs', async (tx) => {
      const [doc] = await tx
        .select({ key: document.driveFileId })
        .from(document)
        .where(eq(document.id, created.id));
      await tx
        .update(supplierAct)
        .set({ pdfFileId: doc?.key ?? null, gdocFileId: out.sourceFileId })
        .where(and(eq(supplierAct.id, actId), isNull(supplierAct.pdfFileId)));
    });
    return { documentId: created.id };
  };
}
