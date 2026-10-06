import type { DbTransaction } from '@tally/db';
import {
  client,
  contract,
  document,
  documentLink,
  DOCUMENT_TYPES,
  LINK_ENTITY_TYPES,
  payee,
  person,
  type LinkEntityType,
} from '@tally/db/schema';
import { numberKey } from '@tally/domain';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { optionalHttpUrl, optionalLocalDate, optionalText, requiredText } from '../fields';
import { documentLinkInput } from '.';
import { lookupLinkTargets } from './targets';

export type LinkChip = {
  entityType: LinkEntityType;
  entityId: string;
  label: string;
  href: string | null;
};

const HREF: Record<LinkEntityType, (id: string) => string> = {
  person: (id) => `/people/${id}`,
  client: (id) => `/clients/${id}`,
  payee: (id) => `/people/payees/${id}`,
  contract: (id) => `/clients/contracts/${id}`,
  contract_annex: (id) => `/clients/contracts/annexes/${id}`,
  assignment: (id) => `/people/assignments/${id}`,
  invoice: (id) => `/invoices/${id}`,
  supplier_act: (id) => `/payroll/acts/${id}`,
  trip: (id) => `/trips/${id}`,
  transaction: (id) => `/ledger/${id}/edit`,
};

/** Human labels for polymorphic links; entities hidden by RLS fall back to a generic label. */
export async function labelLinks(
  tx: DbTransaction,
  links: { entityType: string; entityId: string }[],
): Promise<LinkChip[]> {
  const labels = new Map<string, string>();
  for (const type of LINK_ENTITY_TYPES) {
    const ids = [...new Set(links.filter((l) => l.entityType === type).map((l) => l.entityId))];
    for (const t of await lookupLinkTargets(tx, type, { ids })) labels.set(t.id, t.label);
  }
  return links.map((l) => {
    const type = l.entityType as LinkEntityType;
    const known = labels.get(l.entityId);
    return {
      entityType: type,
      entityId: l.entityId,
      label: known ?? 'documents.recordUnavailable',
      href: known !== undefined ? HREF[type](l.entityId) : null,
    };
  });
}

export const documentFilters = z.object({
  q: optionalText,
  type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(DOCUMENT_TYPES).optional()),
  status: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['draft', 'issued', 'void']).optional(),
  ),
  unlinked: z
    .preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
    .default(false),
  linkedTo: documentLinkInput.optional().describe('Only documents linked to this record'),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

/** Registry (6.9): search by number (number_key) or title, filters by type/status. */
export const searchDocuments = defineService({
  name: 'documents.search',
  input: documentFilters,
  handler: async (ctx, f) => {
    const rows = await inActorScope(ctx, async (tx) => {
      const conditions: SQL[] = [];
      if (f.q) {
        const byText = or(
          ilike(document.numberKey, `%${numberKey(f.q)}%`),
          ilike(document.title, `%${f.q}%`),
        );
        if (byText) conditions.push(byText);
      }
      if (f.type) conditions.push(eq(document.type, f.type));
      if (f.status) conditions.push(eq(document.status, f.status));
      if (f.linkedTo)
        conditions.push(
          sql`exists (select 1 from ${documentLink} dl where dl.document_id = ${document.id} and dl.entity_type = ${f.linkedTo.entityType} and dl.entity_id = ${f.linkedTo.entityId})`,
        );
      if (f.unlinked)
        conditions.push(
          sql`not exists (select 1 from ${documentLink} dl where dl.document_id = ${document.id})`,
        );
      const docs = await tx
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
        .from(document)
        .where(and(...conditions))
        .orderBy(desc(document.docDate), desc(document.createdAt))
        .limit(f.limit);
      const links = docs.length
        ? await tx
            .select({
              documentId: documentLink.documentId,
              entityType: documentLink.entityType,
              entityId: documentLink.entityId,
            })
            .from(documentLink)
            .where(
              inArray(
                documentLink.documentId,
                docs.map((d) => d.id),
              ),
            )
        : [];
      const chips = await labelLinks(tx, links);
      return docs.map(({ fileKey, ...d }) => ({
        ...d,
        hasFile: fileKey !== null,
        links: chips.filter((_, i) => links[i]?.documentId === d.id),
      }));
    });
    return ok(rows);
  },
});

export const getDocument = defineService({
  name: 'documents.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const card = await inActorScope(ctx, async (tx) => {
      const [doc] = await tx.select().from(document).where(eq(document.id, id));
      if (!doc) return null;
      const links = await tx
        .select({ entityType: documentLink.entityType, entityId: documentLink.entityId })
        .from(documentLink)
        .where(eq(documentLink.documentId, id))
        .orderBy(asc(documentLink.createdAt));
      const [newer] = await tx
        .select({ id: document.id })
        .from(document)
        .where(eq(document.supersedesId, id));
      return {
        document: doc,
        links: await labelLinks(tx, links),
        supersededById: newer?.id ?? null,
      };
    });
    return card ? ok(card) : err(serviceError('not_found', 'documents.notFound'));
  },
});

export const updateDocument = defineService({
  name: 'documents.update',
  input: z.object({
    id: z.uuid(),
    title: requiredText('field.name'),
    number: optionalText,
    docDate: optionalLocalDate,
    url: optionalHttpUrl,
    notes: optionalText,
    status: z.enum(['draft', 'issued', 'void']).default('issued'),
  }),
  handler: async (ctx, { id, ...input }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.update(document).set(input).where(eq(document.id, id)).returning({ id: document.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'documents.notFound'));
  },
});

export const linkDocument = defineService({
  name: 'documents.link',
  input: documentLinkInput.extend({ documentId: z.uuid() }),
  handler: async (ctx, input) => {
    await inActorScope(ctx, (tx) => tx.insert(documentLink).values(input).onConflictDoNothing());
    return ok({ id: input.documentId });
  },
});

export const unlinkDocument = defineService({
  name: 'documents.unlink',
  input: documentLinkInput.extend({ documentId: z.uuid() }),
  handler: async (ctx, { documentId, entityType, entityId }) => {
    await inActorScope(ctx, (tx) =>
      tx
        .delete(documentLink)
        .where(
          and(
            eq(documentLink.documentId, documentId),
            eq(documentLink.entityType, entityType),
            eq(documentLink.entityId, entityId),
          ),
        ),
    );
    return ok({ id: documentId });
  },
});

/** Grouped options for the link picker: people, clients, payees, contracts (by RLS). */
export const linkTargets = defineService({
  name: 'documents.linkTargets',
  input: z.object({}),
  handler: async (ctx) => {
    const groups = await inActorScope(ctx, async (tx) => {
      const [people, clients, payees, contracts] = await Promise.all([
        tx
          .select({ id: person.id, label: person.fullName })
          .from(person)
          .orderBy(asc(person.fullName)),
        tx
          .select({
            id: client.id,
            label: sql<string>`coalesce(${client.shortName}, ${client.legalName})`,
          })
          .from(client)
          .orderBy(asc(client.legalName)),
        tx
          .select({
            id: payee.id,
            label: sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`,
          })
          .from(payee)
          .orderBy(asc(payee.legalNameUa)),
        tx
          .select({ id: contract.id, label: contract.number })
          .from(contract)
          .orderBy(asc(contract.number)),
      ]);
      return { person: people, client: clients, payee: payees, contract: contracts };
    });
    return ok(groups);
  },
});

export { LINK_ENTITY_TYPES };
