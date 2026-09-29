import { document, documentLink, LINK_ENTITY_TYPES } from '@tally/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';

export type LinkedDocument = {
  id: string;
  type: string;
  number: string | null;
  title: string;
  docDate: string | null;
  status: string;
  version: number;
  hasFile: boolean;
  url: string | null;
};

/** Documents attached to one entity, newest first; every card shows them (spec 6). */
export const documentsForEntity = defineService({
  name: 'documents.forEntity',
  input: z.object({ entityType: z.enum(LINK_ENTITY_TYPES), entityId: z.uuid() }),
  handler: async (ctx, { entityType, entityId }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: document.id,
          type: document.type,
          number: document.number,
          title: document.title,
          docDate: document.docDate,
          status: document.status,
          version: document.version,
          fileKey: document.driveFileId,
          url: document.url,
        })
        .from(documentLink)
        .innerJoin(document, eq(document.id, documentLink.documentId))
        .where(and(eq(documentLink.entityType, entityType), eq(documentLink.entityId, entityId)))
        .orderBy(desc(document.createdAt)),
    );
    return ok(
      rows.map(({ fileKey, ...r }): LinkedDocument => ({ ...r, hasFile: fileKey !== null })),
    );
  },
});
