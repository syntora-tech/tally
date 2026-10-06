import type { DbTransaction } from '@tally/db';
import {
  assignment,
  client,
  contract,
  contractAnnex,
  document,
  documentLink,
} from '@tally/db/schema';
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';

export const ANNEX_KINDS = ['sow', 'annex'] as const;

/** «SOW 3» for a joined `contract_annex` row; null when the join found none. */
export const annexLabel = sql<
  string | null
>`upper(${contractAnnex.kind}) || ' ' || ${contractAnnex.number}`;
export const ANNEX_STATUSES = ['draft', 'active', 'ended'] as const;

export type AttachedDocument = {
  id: string;
  type: string;
  title: string;
  number: string | null;
  docDate: string | null;
  status: string;
};

/** Documents linked to records of one entity type, keyed by record id. */
export async function attachedDocuments(
  tx: DbTransaction,
  entityType: 'contract' | 'contract_annex',
  ids: string[],
): Promise<Map<string, AttachedDocument[]>> {
  const byId = new Map<string, AttachedDocument[]>();
  if (!ids.length) return byId;
  const rows = await tx
    .select({
      entityId: documentLink.entityId,
      id: document.id,
      type: document.type,
      title: document.title,
      number: document.number,
      docDate: document.docDate,
      status: document.status,
    })
    .from(documentLink)
    .innerJoin(document, eq(document.id, documentLink.documentId))
    .where(and(eq(documentLink.entityType, entityType), inArray(documentLink.entityId, ids)))
    .orderBy(sql`${document.docDate} desc nulls last`, asc(document.title));
  for (const { entityId, ...d } of rows) byId.set(entityId, [...(byId.get(entityId) ?? []), d]);
  return byId;
}

/** SOWs/annexes with their contract, documents and how many assignments run under each. */
export async function loadAnnexes(tx: DbTransaction, where: SQL | undefined) {
  const rows = await tx
    .select({
      annex: contractAnnex,
      contractNumber: contract.number,
      clientId: contract.clientId,
      clientName: sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`,
      assignments: sql<number>`(select count(*)::int from ${assignment} a
        where a.annex_id = "contract_annex"."id")`,
    })
    .from(contractAnnex)
    .innerJoin(contract, eq(contract.id, contractAnnex.contractId))
    .leftJoin(client, eq(client.id, contract.clientId))
    .where(where)
    .orderBy(asc(contract.number), asc(contractAnnex.kind), asc(contractAnnex.number));
  const docs = await attachedDocuments(
    tx,
    'contract_annex',
    rows.map((r) => r.annex.id),
  );
  return rows.map((r) => ({ ...r, documents: docs.get(r.annex.id) ?? [] }));
}

export type AnnexRow = Awaited<ReturnType<typeof loadAnnexes>>[number];

export const listContractAnnexes = defineService({
  name: 'contracts.annexes.list',
  input: z.object({
    contractId: z.uuid().optional().describe('SOWs/annexes of one contract'),
    clientId: z.uuid().optional().describe('SOWs/annexes of all contracts of one client'),
    status: z.enum(ANNEX_STATUSES).optional(),
  }),
  handler: async (ctx, input) => {
    const filters = [
      input.contractId ? eq(contractAnnex.contractId, input.contractId) : undefined,
      input.clientId ? eq(contract.clientId, input.clientId) : undefined,
      input.status ? eq(contractAnnex.status, input.status) : undefined,
    ];
    return ok(await inActorScope(ctx, (tx) => loadAnnexes(tx, and(...filters))));
  },
});

export const getContractAnnex = defineService({
  name: 'contracts.annexes.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) => loadAnnexes(tx, eq(contractAnnex.id, id)));
    return row ? ok(row) : err(serviceError('not_found', 'contracts.annexNotFound'));
  },
});

/** SOWs/annexes of active client contracts for the assignment form, grouped by contract. */
export const annexOptions = defineService({
  name: 'contracts.annexes.options',
  input: z.object({ contractId: z.uuid().optional() }),
  handler: async (ctx, { contractId }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          value: contractAnnex.id,
          contractId: contractAnnex.contractId,
          label: sql<string>`${annexLabel} || coalesce(' · ' || ${contractAnnex.title}, '')`,
        })
        .from(contractAnnex)
        .innerJoin(contract, eq(contract.id, contractAnnex.contractId))
        .where(
          contractId
            ? eq(contractAnnex.contractId, contractId)
            : and(eq(contract.kind, 'client'), eq(contract.status, 'active')),
        )
        .orderBy(asc(contractAnnex.kind), asc(contractAnnex.number)),
    );
    return ok(rows);
  },
});
