import type { DbTransaction } from '@tally/db';
import type { LocalDate } from '@tally/domain';
import { document, documentLink, DOCUMENT_TYPES, LINK_ENTITY_TYPES } from '@tally/db/schema';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { folderPathFor } from '../../storage/folders';
import type { DocumentStorage } from '../../storage/types';
import { inActorScopeAtomic } from '../atomic';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import {
  httpUrl,
  localDateString,
  optionalHttpUrl,
  optionalLocalDate,
  optionalText,
} from '../fields';
import { extractPages, parsePageRanges, pdfPageCount } from './package';
import { labelLinks, type LinkChip } from './registry';
import { lookupLinkTargets } from './targets';
import {
  documentLinkInput,
  insertDocumentRow,
  resolveAnchor,
  storeDocumentFile,
  type StoredDocumentFile,
} from '.';

/**
 * Vercel caps a request (and a response) at 4.5 MB and base64 adds a third, so an agent's file —
 * and all files of one call together — stay within 3 MB (A-071).
 */
export const MAX_AGENT_FILE_BYTES = 3 * 1024 * 1024;

const dryRun = z.boolean().default(false).describe('Validate and preview without writing');

/** A file sent inline by an agent (13.4 rule 7); the server never fetches URLs. */
export const agentFile = z
  .object({
    fileName: z.string().trim().min(1).max(200).describe('File name with extension, e.g. nda.pdf'),
    mimeType: z
      .string()
      .trim()
      .regex(/^[\w.+-]+\/[\w.+-]+$/, 'documents.mimeType')
      .describe('e.g. application/pdf, image/jpeg'),
    contentBase64: z
      .string()
      .describe('File bytes in base64 (a data: URL prefix is allowed); at most 3 MB decoded'),
  })
  .transform((f, issues) => {
    const clean = f.contentBase64.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
    if (!clean || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
      issues.addIssue({ code: 'custom', path: ['contentBase64'], message: 'documents.base64' });
      return z.NEVER;
    }
    const bytes = Buffer.from(clean, 'base64');
    if (bytes.length > MAX_AGENT_FILE_BYTES) {
      issues.addIssue({
        code: 'custom',
        path: ['contentBase64'],
        message: 'documents.agentTooLarge',
      });
      return z.NEVER;
    }
    return new File([bytes], f.fileName, { type: f.mimeType });
  });

const newDocument = z
  .object({
    type: z.enum(DOCUMENT_TYPES),
    title: z.string().trim().min(1).max(1_000),
    number: optionalText,
    docDate: optionalLocalDate.describe('YYYY-MM-DD; also picks the year folder'),
    url: optionalHttpUrl.describe('Link to the document elsewhere (e.g. Vchasno); never fetched'),
    notes: optionalText,
    file: agentFile.optional(),
    links: z
      .array(documentLinkInput)
      .max(20)
      .default([])
      .describe('Records to attach it to; the first one picks the Drive folder'),
    supersedesId: z.uuid().optional().describe('Make it the next version of this document'),
  })
  .refine((d) => d.file ?? d.url, { message: 'documents.fileOrUrl', path: ['file'] });

type Problems = Record<string, string[]>;

const failed = (errors: Problems) =>
  err(
    serviceError(
      'validation_error',
      msg('batch.failedItems', { count: Object.keys(errors).length }),
      errors,
    ),
  );

/** Links whose target is missing or hidden by RLS, as error messages. */
async function missingTargets(
  tx: DbTransaction,
  links: { entityType: (typeof LINK_ENTITY_TYPES)[number]; entityId: string }[],
): Promise<string[]> {
  const chips = await labelLinks(tx, links);
  return chips
    .filter((c) => c.href === null)
    .map((c) => msg('documents.targetMissing', { type: c.entityType, id: c.entityId }));
}

/**
 * Documents produced by Tally itself (generated or signed invoice/act files) belong to their
 * invoice or act: agents may read and link them but not edit them or cut those links.
 */
async function systemOwned(tx: DbTransaction, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await tx
    .select({ id: document.id })
    .from(document)
    .where(
      and(
        inArray(document.id, ids),
        sql`(${document.sourceRevision} is not null or ${document.signedAt} is not null
          or (${document.type} in ('invoice', 'act') and exists (
            select 1 from ${documentLink} dl where dl.document_id = "document"."id"
              and dl.entity_type in ('invoice', 'supplier_act'))))`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

type DeletedDocument = {
  id: string;
  type: string;
  title: string;
  number: string | null;
  links: number;
  status: 'would_delete' | 'deleted';
  file: 'trash' | 'kept_shared' | 'none' | 'trash_failed';
};

type Preview = {
  index: number;
  version: number;
  folderPath: string | null;
  links: LinkChip[];
  supersedes: { id: string; version: number } | null;
};

/** Agent-facing document services; storage is injected like the UI's (A-071). */
export function documentAgentServices(getStorage: () => DocumentStorage) {
  const addDocuments = defineService({
    name: 'documents.addBatch',
    input: z.object({ documents: z.array(newDocument).min(1).max(10), dryRun }),
    handler: async (ctx, input) => {
      const total = input.documents.reduce((s, d) => s + (d.file?.size ?? 0), 0);
      if (total > MAX_AGENT_FILE_BYTES) {
        return err(serviceError('validation_error', 'documents.agentTooLarge'));
      }

      const check = await inActorScope(ctx, async (tx) => {
        const errors: Problems = {};
        const previews: Preview[] = [];
        for (const [index, d] of input.documents.entries()) {
          const key = `documents.${String(index)}`;
          const problems = await missingTargets(tx, d.links);
          let supersedes: Preview['supersedes'] = null;
          if (d.supersedesId) {
            const [old] = await tx
              .select({ id: document.id, version: document.version, type: document.type })
              .from(document)
              .where(eq(document.id, d.supersedesId));
            const [newer] = await tx
              .select({ id: document.id })
              .from(document)
              .where(eq(document.supersedesId, d.supersedesId));
            if (!old) problems.push('documents.notFound');
            else if (newer) problems.push('documents.alreadySuperseded');
            else if (old.type !== d.type) problems.push('documents.versionType');
            else supersedes = { id: old.id, version: old.version };
          }
          if (problems.length) {
            errors[key] = problems;
            continue;
          }
          const anchor = d.file ? await resolveAnchor(tx, d.links[0], ctx.today) : null;
          previews.push({
            index,
            version: supersedes ? supersedes.version + 1 : 1,
            folderPath: anchor
              ? folderPathFor(d.type, anchor, (d.docDate ?? ctx.today).slice(0, 4))
              : null,
            links: await labelLinks(tx, d.links),
            supersedes,
          });
        }
        const repeated = input.documents
          .map((d) => d.supersedesId)
          .filter((id, i, all) => id && all.indexOf(id) !== i);
        if (repeated.length) errors.documents = ['documents.alreadySuperseded'];
        return { errors, previews };
      });
      if (Object.keys(check.errors).length) return failed(check.errors);

      const present = (p: Preview, id: string | null) => ({
        index: p.index,
        id,
        status: id ? ('created' as const) : ('preview' as const),
        version: p.version,
        folderPath: p.folderPath,
        links: p.links.map(({ entityType, entityId, label }) => ({ entityType, entityId, label })),
      });
      if (input.dryRun) return ok({ results: check.previews.map((p) => present(p, null)) });

      // Files go up only after the whole batch checked out, so a refused batch leaves no files.
      const stored: (StoredDocumentFile | null)[] = [];
      for (const d of input.documents) {
        stored.push(
          d.file ? await storeDocumentFile(ctx, getStorage(), { ...d, file: d.file }) : null,
        );
      }
      return inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
        const results = [];
        for (const p of check.previews) {
          const doc = input.documents[p.index];
          if (!doc) continue;
          const row = await insertDocumentRow(
            tx,
            {
              type: doc.type,
              title: doc.title,
              number: doc.number,
              docDate: doc.docDate,
              url: doc.url,
              notes: doc.notes,
              links: doc.links,
              ...(p.supersedes ? { supersedes: p.supersedes } : {}),
            },
            stored[p.index] ?? null,
          );
          results.push(present(p, row.id));
        }
        return ok({ results });
      });
    },
  });

  const getDocumentForAgent = defineService({
    name: 'documents.getForAgent',
    input: z.object({
      id: z.uuid(),
      includeContent: z
        .boolean()
        .default(false)
        .describe('Also return the file bytes as base64 (files up to 3 MB)'),
    }),
    handler: async (ctx, { id, includeContent }) => {
      const card = await inActorScope(ctx, async (tx) => {
        const [doc] = await tx.select().from(document).where(eq(document.id, id));
        if (!doc) return null;
        const links = await tx
          .select({ entityType: documentLink.entityType, entityId: documentLink.entityId })
          .from(documentLink)
          .where(eq(documentLink.documentId, id))
          .orderBy(documentLink.createdAt);
        const versions = await tx.execute<{
          id: string;
          version: number;
          title: string;
          doc_date: string | null;
          status: string;
        }>(sql`
          with recursive older as (
            select id, supersedes_id from public.document where id = ${id}
            union all
            select d.id, d.supersedes_id from public.document d join older o on d.id = o.supersedes_id
          ), newer as (
            select id from public.document where id = ${id}
            union all
            select d.id from public.document d join newer n on d.supersedes_id = n.id
          )
          select id, version, title, doc_date, status from public.document
          where id in (select id from older union select id from newer)
          order by version`);
        const [pkg] = doc.packageId
          ? await tx
              .select({ id: document.id, title: document.title })
              .from(document)
              .where(eq(document.id, doc.packageId))
          : [];
        const parts = await tx
          .select({
            id: document.id,
            type: document.type,
            title: document.title,
            number: document.number,
            pages: document.packagePages,
          })
          .from(document)
          .where(eq(document.packageId, doc.id))
          .orderBy(document.createdAt);
        return {
          doc,
          links: await labelLinks(tx, links),
          versions: [...versions],
          package: pkg ? { ...pkg, pages: doc.packagePages } : null,
          parts,
        };
      });
      if (!card) return err(serviceError('not_found', 'documents.notFound'));

      const { doc } = card;
      const storage = doc.driveFileId ? getStorage() : null;
      let content: { contentBase64: string; mimeType: string } | null = null;
      let contentOmitted: 'no_file' | 'too_large' | 'unavailable' | null = null;
      if (includeContent) {
        if (!doc.driveFileId || !storage) contentOmitted = 'no_file';
        else if ((doc.sizeBytes ?? 0) > MAX_AGENT_FILE_BYTES) contentOmitted = 'too_large';
        else {
          const file = await storage.download(doc.driveFileId);
          if (!file) contentOmitted = 'unavailable';
          else if (file.data.length > MAX_AGENT_FILE_BYTES) contentOmitted = 'too_large';
          else
            content = {
              contentBase64: Buffer.from(file.data).toString('base64'),
              mimeType: file.mimeType,
            };
        }
      }
      const current = card.versions.at(-1);
      return ok({
        id: doc.id,
        type: doc.type,
        number: doc.number,
        title: doc.title,
        docDate: doc.docDate,
        status: doc.status,
        version: doc.version,
        notes: doc.notes,
        url: doc.url,
        hasFile: doc.driveFileId !== null,
        fileName: doc.fileName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        viewUrl: doc.driveFileId && storage ? storage.viewUrl(doc.driveFileId) : null,
        signedAt: doc.signedAt,
        package: card.package,
        parts: card.parts,
        isLatestVersion: current?.id === doc.id,
        versions: card.versions.map((v) => ({
          id: v.id,
          version: v.version,
          title: v.title,
          docDate: v.doc_date,
          status: v.status,
        })),
        links: card.links.map(({ entityType, entityId, label }) => ({
          entityType,
          entityId,
          label,
        })),
        ...(includeContent ? { content, contentOmitted } : {}),
      });
    },
  });

  /**
   * Removes documents uploaded by mistake with their links; the files go to the Drive trash once
   * the rows are gone, and a file another document still uses is kept (A-072).
   */
  const deleteDocuments = defineService({
    name: 'documents.deleteBatch',
    input: z.object({
      ids: z.array(z.uuid()).min(1).max(200).describe('Document ids (from search_documents)'),
      dryRun,
    }),
    handler: async (ctx, input) => {
      const result = await inActorScopeAtomic(ctx, input, async (tx) => {
        const ids = [...new Set(input.ids)];
        const rows = await tx
          .select({
            id: document.id,
            type: document.type,
            title: document.title,
            number: document.number,
            driveFileId: document.driveFileId,
            supersedesId: document.supersedesId,
            links: sql<number>`(select count(*)::int from public.document_link dl
              where dl.document_id = "document"."id")`,
          })
          .from(document)
          .where(inArray(document.id, ids));
        const locked = await systemOwned(tx, ids);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const errors: Problems = {};
        for (const [index, id] of input.ids.entries()) {
          const key = `ids.${String(index)}`;
          if (!byId.has(id)) errors[key] = ['documents.notFound'];
          else if (locked.has(id)) errors[key] = ['documents.systemOwned'];
        }
        if (Object.keys(errors).length) return failed(errors);

        // A newer version of a deleted document moves down to the nearest surviving predecessor.
        const survivingPredecessor = (id: string | null): string | null => {
          let current = id;
          while (current && byId.has(current)) current = byId.get(current)?.supersedesId ?? null;
          return current;
        };
        const successors = await tx
          .select({ id: document.id, supersedesId: document.supersedesId })
          .from(document)
          .where(and(inArray(document.supersedesId, ids), notInArray(document.id, ids)));
        await tx.update(document).set({ supersedesId: null }).where(inArray(document.id, ids));
        for (const s of successors) {
          await tx
            .update(document)
            .set({ supersedesId: survivingPredecessor(s.supersedesId) })
            .where(eq(document.id, s.id));
        }
        await tx.delete(document).where(inArray(document.id, ids));

        const keys = [...new Set(rows.flatMap((r) => (r.driveFileId ? [r.driveFileId] : [])))];
        const shared = keys.length
          ? await tx
              .selectDistinct({ key: document.driveFileId })
              .from(document)
              .where(inArray(document.driveFileId, keys))
          : [];
        const keep = new Set(shared.map((r) => r.key));
        return ok(
          ids.map((id) => {
            const r = byId.get(id);
            if (!r) throw new Error('Checked above');
            const file: 'trash' | 'kept_shared' | 'none' = !r.driveFileId
              ? 'none'
              : keep.has(r.driveFileId)
                ? 'kept_shared'
                : 'trash';
            return {
              id,
              type: r.type,
              title: r.title,
              number: r.number,
              links: r.links,
              file,
              key: r.driveFileId,
            };
          }),
        );
      });
      if (result.isErr()) return err(result.error);

      const trashed = new Map<string, boolean>();
      if (!input.dryRun) {
        const storage = getStorage();
        for (const r of result.value) {
          if (r.file !== 'trash' || !r.key || trashed.has(r.key)) continue;
          try {
            await storage.trash(r.key);
            trashed.set(r.key, true);
          } catch (error) {
            console.error('documents.deleteBatch: file not trashed', r.key, error);
            trashed.set(r.key, false);
          }
        }
      }
      const results: DeletedDocument[] = result.value.map(({ key, ...r }) => ({
        ...r,
        status: input.dryRun ? 'would_delete' : 'deleted',
        file:
          !input.dryRun && r.file === 'trash' && key && !trashed.get(key) ? 'trash_failed' : r.file,
      }));
      return ok({ results });
    },
  });

  /**
   * Cuts a signed PDF into its documents (A-078). The original becomes a `package` and keeps its
   * file, signatures and links; every part is its own document with a copy of its pages, a
   * pointer to the package and its own links (by default the package's people, clients and
   * payees). A package may get more parts later.
   */
  const splitDocument = defineService({
    name: 'documents.split',
    input: z.object({
      id: z.uuid().describe('The signed document holding several documents'),
      parts: z
        .array(
          z.object({
            type: z.enum(DOCUMENT_TYPES).refine((t) => t !== 'package', 'documents.partType'),
            title: z.string().trim().min(1).max(1_000),
            number: optionalText,
            docDate: optionalLocalDate.describe("Defaults to the package's date"),
            pages: z
              .string()
              .trim()
              .regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/, 'documents.pages')
              .describe('1-based pages of the package, e.g. "1-10" or "1,3-4"'),
            notes: optionalText,
            links: z
              .array(documentLinkInput)
              .max(20)
              .optional()
              .describe(
                "Records of this part (contract, contract_annex, invoice…); defaults to the package's person/client/payee links",
              ),
          }),
        )
        .min(1)
        .max(20),
      dryRun,
    }),
    handler: async (ctx, input) => {
      const loaded = await inActorScope(ctx, async (tx) => {
        const [doc] = await tx.select().from(document).where(eq(document.id, input.id));
        if (!doc) return { problem: 'documents.notFound' } as const;
        if (doc.packageId) return { problem: 'documents.partOfPackage' } as const;
        if ((await systemOwned(tx, [doc.id])).size) {
          return { problem: 'documents.systemOwned' } as const;
        }
        if (!doc.driveFileId || doc.mimeType !== 'application/pdf') {
          return { problem: 'documents.splitPdfOnly' } as const;
        }
        const links = await tx
          .select({ entityType: documentLink.entityType, entityId: documentLink.entityId })
          .from(documentLink)
          .where(eq(documentLink.documentId, doc.id))
          .orderBy(documentLink.createdAt);
        return { doc, links };
      });
      if ('problem' in loaded) {
        return err(serviceError('validation_error', loaded.problem ?? 'documents.notFound'));
      }
      const { doc } = loaded;
      const file = await getStorage().download(doc.driveFileId ?? '');
      const pageCount = file ? await pdfPageCount(file.data) : null;
      if (!file || pageCount === null) {
        return err(serviceError('validation_error', 'documents.splitPdfOnly'));
      }

      const parties = loaded.links.filter((l) =>
        ['person', 'client', 'payee'].includes(l.entityType),
      ) as { entityType: (typeof LINK_ENTITY_TYPES)[number]; entityId: string }[];
      const errors: Problems = {};
      const plan = await inActorScope(ctx, async (tx) => {
        const parts = [];
        for (const [index, part] of input.parts.entries()) {
          const key = `parts.${String(index)}`;
          const pages = parsePageRanges(part.pages, pageCount);
          const links = part.links ?? parties;
          const problems = await missingTargets(tx, links);
          if (!pages) problems.push(msg('documents.pagesOutOfRange', { count: pageCount }));
          if (problems.length) {
            errors[key] = problems;
            continue;
          }
          const docDate = part.docDate ?? (doc.docDate as LocalDate | null);
          const anchor = await resolveAnchor(tx, links[0], ctx.today);
          parts.push({
            ...part,
            index,
            docDate,
            links,
            pageList: pages ?? [],
            folderPath: folderPathFor(part.type, anchor, (docDate ?? ctx.today).slice(0, 4)),
            chips: await labelLinks(tx, links),
          });
        }
        return parts;
      });
      if (Object.keys(errors).length) return failed(errors);

      const present = (p: (typeof plan)[number], id: string | null) => ({
        index: p.index,
        id,
        status: id ? ('created' as const) : ('preview' as const),
        type: p.type,
        title: p.title,
        pages: p.pages,
        folderPath: p.folderPath,
        links: p.chips.map(({ entityType, entityId, label }) => ({ entityType, entityId, label })),
      });
      const packageView = { id: doc.id, title: doc.title, pageCount, wasType: doc.type };
      if (input.dryRun) {
        return ok({ package: packageView, parts: plan.map((p) => present(p, null)) });
      }

      // Copies go up before the transaction, like any upload; the original file is untouched.
      const stored: StoredDocumentFile[] = [];
      for (const p of plan) {
        const data = await extractPages(file.data, p.pageList);
        stored.push(
          await storeDocumentFile(ctx, getStorage(), {
            type: p.type,
            docDate: p.docDate,
            links: p.links,
            file: new File([Buffer.from(data)], `${p.title}.pdf`, { type: 'application/pdf' }),
          }),
        );
      }
      return inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
        await tx.update(document).set({ type: 'package' }).where(eq(document.id, doc.id));
        const parts = [];
        for (const [i, p] of plan.entries()) {
          const row = await insertDocumentRow(
            tx,
            {
              type: p.type,
              title: p.title,
              number: p.number,
              docDate: p.docDate,
              url: null,
              notes: p.notes,
              links: p.links,
              package: { id: doc.id, pages: p.pages },
            },
            stored[i] ?? null,
          );
          parts.push(present(p, row.id));
        }
        return ok({ package: packageView, parts });
      });
    },
  });

  return { addDocuments, getDocumentForAgent, deleteDocuments, splitDocument };
}

const documentChange = z.object({
  id: z.uuid(),
  type: z
    .enum(DOCUMENT_TYPES)
    .refine((t) => t !== 'package', 'documents.packageViaSplit')
    .optional()
    .describe('e.g. invoice → bill for an invoice issued to us; packages come from split_document'),
  title: z.string().trim().min(1).max(1_000).optional(),
  number: z.string().trim().max(200).nullable().optional(),
  docDate: localDateString.nullable().optional(),
  url: httpUrl.nullable().optional().describe('null removes the link'),
  notes: z.string().trim().max(10_000).nullable().optional(),
  status: z
    .enum(['draft', 'issued', 'void'])
    .optional()
    .describe('issued = active; void marks a document as cancelled instead of deleting it'),
});

/** Metadata corrections for agents; only the fields sent change (A-071). */
export const updateDocuments = defineService({
  name: 'documents.updateBatch',
  input: z.object({ documents: z.array(documentChange).min(1).max(100), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Problems = {};
      const locked = await systemOwned(
        tx,
        input.documents.map((d) => d.id),
      );
      const results: { index: number; id: string; status: 'updated' }[] = [];
      for (const [index, { id, ...change }] of input.documents.entries()) {
        const key = `documents.${String(index)}`;
        if (locked.has(id)) {
          errors[key] = ['documents.systemOwned'];
          continue;
        }
        // Zod leaves out the keys that were not sent, so `change` holds only real edits.
        const set: Partial<typeof document.$inferInsert> = change;
        if (!Object.keys(set).length) {
          errors[key] = ['documents.nothingToChange'];
          continue;
        }
        const [row] = await tx
          .update(document)
          .set(set)
          .where(eq(document.id, id))
          .returning({ id: document.id, driveFileId: document.driveFileId, url: document.url });
        if (!row) errors[key] = ['documents.notFound'];
        else if (!row.driveFileId && !row.url) errors[key] = ['documents.fileOrUrl'];
        else results.push({ index, id, status: 'updated' });
      }
      return Object.keys(errors).length ? failed(errors) : ok({ results });
    }),
});

const linkItem = documentLinkInput.extend({ documentId: z.uuid() });

/** Attaches documents to records; an existing link is reported, not duplicated (A-071). */
export const linkDocuments = defineService({
  name: 'documents.linkBatch',
  input: z.object({ links: z.array(linkItem).min(1).max(200), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Problems = {};
      const results = [];
      for (const [index, l] of input.links.entries()) {
        const key = `links.${String(index)}`;
        const [doc] = await tx
          .select({ id: document.id })
          .from(document)
          .where(eq(document.id, l.documentId));
        const problems = doc ? await missingTargets(tx, [l]) : ['documents.notFound'];
        if (problems.length) {
          errors[key] = problems;
          continue;
        }
        const [inserted] = await tx
          .insert(documentLink)
          .values(l)
          .onConflictDoNothing()
          .returning({ id: documentLink.id });
        const [chip] = await labelLinks(tx, [l]);
        results.push({
          index,
          ...l,
          label: chip?.label ?? null,
          status: inserted ? ('linked' as const) : ('existing' as const),
        });
      }
      return Object.keys(errors).length ? failed(errors) : ok({ results });
    }),
});

/** Detaches documents from records; links of Tally's own invoice/act files stay (A-071). */
export const unlinkDocuments = defineService({
  name: 'documents.unlinkBatch',
  input: z.object({ links: z.array(linkItem).min(1).max(200), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Problems = {};
      const locked = await systemOwned(
        tx,
        input.links.map((l) => l.documentId),
      );
      const results = [];
      for (const [index, l] of input.links.entries()) {
        const key = `links.${String(index)}`;
        if (
          locked.has(l.documentId) &&
          (l.entityType === 'invoice' || l.entityType === 'supplier_act')
        ) {
          errors[key] = ['documents.systemLink'];
          continue;
        }
        const removed = await tx
          .delete(documentLink)
          .where(
            and(
              eq(documentLink.documentId, l.documentId),
              eq(documentLink.entityType, l.entityType),
              eq(documentLink.entityId, l.entityId),
            ),
          )
          .returning({ id: documentLink.id });
        results.push({
          index,
          ...l,
          status: removed.length ? ('unlinked' as const) : ('missing' as const),
        });
      }
      return Object.keys(errors).length ? failed(errors) : ok({ results });
    }),
});

/** Records a document can be attached to, searched by text (A-071). */
export const findLinkTargets = defineService({
  name: 'documents.findTargets',
  input: z.object({
    entityType: z.enum(LINK_ENTITY_TYPES),
    q: optionalText.describe('Text to search: name, number, title, description'),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  handler: async (ctx, { entityType, q, limit }) =>
    ok(await inActorScope(ctx, (tx) => lookupLinkTargets(tx, entityType, { q, limit }))),
});
