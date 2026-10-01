import type { DbTransaction } from '@tally/db';
import {
  assignment,
  client,
  contract,
  document,
  documentLink,
  DOCUMENT_TYPES,
  LINK_ENTITY_TYPES,
  payee,
  person,
} from '@tally/db/schema';
import { and, eq, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { folderPathFor, type FolderAnchor } from '../../storage/folders';
import type { DocumentStorage } from '../../storage/types';
import { inActorScope, type ServiceContext } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { signedCopyTarget } from '../invoices';
import { optionalHttpUrl, optionalLocalDate, optionalText, requiredText } from '../fields';

/** Vercel caps function request bodies at 4.5 MB (assumptions A-027). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const uploadFile = z
  .instanceof(File, { error: 'documents.chooseFile' })
  .refine((f) => f.size > 0, 'documents.emptyFile')
  .refine((f) => f.size <= MAX_UPLOAD_BYTES, 'documents.tooLarge');

const optionalFile = z.preprocess(
  // An untouched file input still posts an empty File; treat it as "no file".
  (v) => (v instanceof File && v.size === 0 ? undefined : v),
  uploadFile.optional(),
);

export const documentLinkInput = z.object({
  entityType: z.enum(LINK_ENTITY_TYPES),
  entityId: z.uuid(),
});

export const createDocumentInput = z
  .object({
    type: z.enum(DOCUMENT_TYPES),
    title: requiredText('field.name'),
    number: optionalText,
    docDate: optionalLocalDate,
    url: optionalHttpUrl,
    notes: optionalText,
    file: optionalFile,
    links: z.array(documentLinkInput).max(20).default([]),
  })
  .refine((d) => d.file ?? d.url, { message: 'documents.fileOrUrl', path: ['file'] });

type LinkInput = z.output<typeof documentLinkInput>;

/** Folder owner for a document: its first link resolved to a person, client or payee (7.3). */
async function resolveAnchor(
  tx: DbTransaction,
  link: LinkInput | undefined,
): Promise<FolderAnchor> {
  if (!link) return { kind: 'none' };
  const { entityType, entityId } = link;
  if (entityType === 'person') {
    const [p] = await tx
      .select({ name: person.fullName })
      .from(person)
      .where(eq(person.id, entityId));
    return p ? { kind: 'person', name: p.name } : { kind: 'none' };
  }
  if (entityType === 'client') {
    const [c] = await tx
      .select({ name: sql<string>`coalesce(${client.shortName}, ${client.legalName})` })
      .from(client)
      .where(eq(client.id, entityId));
    return c ? { kind: 'client', name: c.name } : { kind: 'none' };
  }
  if (entityType === 'payee') {
    const [p] = await tx
      .select({ name: sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})` })
      .from(payee)
      .where(eq(payee.id, entityId));
    return p ? { kind: 'payee', name: p.name } : { kind: 'none' };
  }
  if (entityType === 'contract' || entityType === 'assignment') {
    const contractId =
      entityType === 'contract'
        ? entityId
        : (
            await tx
              .select({ contractId: assignment.contractId, personId: assignment.personId })
              .from(assignment)
              .where(eq(assignment.id, entityId))
          )[0]?.contractId;
    if (!contractId) return { kind: 'none' };
    const [c] = await tx
      .select({
        clientName: sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`,
        payeeName: sql<string | null>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`,
      })
      .from(contract)
      .leftJoin(client, eq(client.id, contract.clientId))
      .leftJoin(payee, eq(payee.id, contract.payeeId))
      .where(eq(contract.id, contractId));
    if (c?.clientName) return { kind: 'client', name: c.clientName };
    if (c?.payeeName) return { kind: 'payee', name: c.payeeName };
  }
  return { kind: 'none' };
}

type NewDocument = z.output<typeof createDocumentInput> & {
  supersedes?: { id: string; version: number };
  /** Invoice/act revision the file shows; `signedAt` marks an uploaded signed copy. */
  sourceRevision?: number;
  signedAt?: Date;
};

/**
 * Stores the file (if any) and inserts the document with its links. The upload runs before the
 * DB transaction so no transaction is held open during network I/O.
 */
export async function insertDocument(
  ctx: ServiceContext,
  storage: DocumentStorage,
  input: NewDocument,
): Promise<{ id: string }> {
  let stored: { key: string; fileName: string; mimeType: string; sizeBytes: number } | null = null;
  if (input.file) {
    const anchor = await inActorScope(ctx, (tx) => resolveAnchor(tx, input.links[0]));
    const year = (input.docDate ?? ctx.today).slice(0, 4);
    const { key } = await storage.upload({
      folderPath: folderPathFor(input.type, anchor, year),
      fileName: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      data: new Uint8Array(await input.file.arrayBuffer()),
    });
    stored = {
      key,
      fileName: input.file.name,
      mimeType: input.file.type || 'application/octet-stream',
      sizeBytes: input.file.size,
    };
  }

  return inActorScope(ctx, async (tx) => {
    const [row] = await tx
      .insert(document)
      .values({
        type: input.type,
        title: input.title,
        number: input.number,
        docDate: input.docDate,
        url: input.url,
        notes: input.notes,
        driveFileId: stored?.key ?? null,
        fileName: stored?.fileName ?? null,
        mimeType: stored?.mimeType ?? null,
        sizeBytes: stored?.sizeBytes ?? null,
        version: input.supersedes ? input.supersedes.version + 1 : 1,
        supersedesId: input.supersedes?.id ?? null,
        signedAt: input.signedAt ?? null,
        sourceRevision: input.sourceRevision ?? null,
      })
      .returning({ id: document.id });
    if (!row) throw new Error('Document insert returned no row');
    if (input.links.length) {
      await tx
        .insert(documentLink)
        .values(input.links.map((l) => ({ documentId: row.id, ...l })))
        .onConflictDoNothing();
    }
    return row;
  });
}

/** Service factory: storage is injected so tests can use a temp-dir LocalStorage. */
export function documentServices(getStorage: () => DocumentStorage) {
  const createDocument = defineService({
    name: 'documents.create',
    input: createDocumentInput,
    handler: async (ctx, input) => ok(await insertDocument(ctx, getStorage(), input)),
  });

  /** CV upload (6.2): PDF into people/{slug}/cv; a new upload supersedes the current version. */
  const uploadCv = defineService({
    name: 'people.uploadCv',
    input: z.object({
      personId: z.uuid(),
      file: uploadFile.refine(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
        'documents.cvPdf',
      ),
    }),
    handler: async (ctx, { personId, file }) => {
      const found = await inActorScope(ctx, async (tx) => {
        const [p] = await tx.select({ id: person.id }).from(person).where(eq(person.id, personId));
        if (!p) return null;
        const next = alias(document, 'next_version');
        const [current] = await tx
          .select({ id: document.id, version: document.version })
          .from(document)
          .innerJoin(documentLink, eq(documentLink.documentId, document.id))
          .where(
            and(
              eq(document.type, 'cv'),
              eq(documentLink.entityType, 'person'),
              eq(documentLink.entityId, personId),
              notExists(
                tx.select({ id: next.id }).from(next).where(eq(next.supersedesId, document.id)),
              ),
            ),
          )
          .limit(1);
        return { current: current ?? null };
      });
      if (!found) return err(serviceError('not_found', 'people.notFound'));

      const created = await insertDocument(ctx, getStorage(), {
        type: 'cv',
        title: file.name.replace(/\.pdf$/i, ''),
        number: null,
        docDate: ctx.today,
        url: null,
        notes: null,
        file,
        links: [{ entityType: 'person', entityId: personId }],
        ...(found.current ? { supersedes: found.current } : {}),
      });
      return ok(created);
    },
  });

  /**
   * Signed copy of an issued invoice (A-039): supersedes the generated file and remembers which
   * revision was signed, so a later revision marks it as outdated.
   */
  const attachSignedInvoice = defineService({
    name: 'invoices.attachSigned',
    input: z.object({ invoiceId: z.uuid(), file: uploadFile }),
    handler: async (ctx, { invoiceId, file }) => {
      const target = await signedCopyTarget(ctx, invoiceId);
      if (!target) return err(serviceError('not_found', 'documents.issuedInvoiceNotFound'));
      const created = await insertDocument(ctx, getStorage(), {
        type: 'invoice',
        title: `Invoice ${target.number} (signed)`,
        number: target.number,
        docDate: target.issueDate,
        url: null,
        notes: null,
        file,
        links: [
          { entityType: 'invoice', entityId: invoiceId },
          { entityType: 'client', entityId: target.clientId },
        ],
        signedAt: new Date(),
        sourceRevision: target.revision,
        ...(target.current ? { supersedes: target.current } : {}),
      });
      return ok(created);
    },
  });

  return { createDocument, uploadCv, attachSignedInvoice };
}
