import { client, contract, contractAnnex, document, documentLink, payee } from '@tally/db/schema';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';

/** Documents that belong to a month of work; the rest are the agreements themselves (A-079). */
export const PERIOD_TYPES: readonly string[] = ['invoice', 'bill', 'act', 'receipt', 'statement'];

export type DossierDoc = {
  id: string;
  type: string;
  number: string | null;
  title: string;
  docDate: string | null;
  status: string;
  hasFile: boolean;
  url: string | null;
  packageId: string | null;
  packagePages: string | null;
  contractIds: string[];
  annexIds: string[];
};

export type DossierMonth = { month: string | null; docs: DossierDoc[] };
export type DossierShelf = { docs: DossierDoc[]; months: DossierMonth[] };

type ContractRow = {
  id: string;
  kind: string;
  number: string;
  status: string;
  signedOn: string | null;
};
type AnnexRow = {
  id: string;
  contractId: string;
  kind: string;
  number: string;
  title: string | null;
  status: string;
  validFrom: string | null;
};

export type Dossier = {
  contracts: (ContractRow &
    DossierShelf & { annexes: (AnnexRow & DossierShelf)[]; total: number })[];
  unfiled: DossierShelf;
};

const byDate = (a: DossierDoc, b: DossierDoc) =>
  (a.docDate ?? '').localeCompare(b.docDate ?? '') || a.title.localeCompare(b.title);

function shelf(docs: DossierDoc[]): DossierShelf {
  const months = new Map<string | null, DossierDoc[]>();
  const agreements: DossierDoc[] = [];
  for (const d of docs) {
    if (!PERIOD_TYPES.includes(d.type)) {
      agreements.push(d);
      continue;
    }
    const month = d.docDate ? d.docDate.slice(0, 7) : null;
    months.set(month, [...(months.get(month) ?? []), d]);
  }
  return {
    docs: agreements.sort(byDate),
    // Newest month first; undated documents last.
    months: [...months.entries()]
      .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))
      .map(([month, list]) => ({ month, docs: list.sort(byDate) })),
  };
}

/**
 * Files every document of a counterparty under the most specific record it is linked to: a
 * SOW/annex, else a contract, else "without a contract" (A-079).
 */
export function buildDossier(
  contracts: ContractRow[],
  annexes: AnnexRow[],
  docs: DossierDoc[],
): Dossier {
  const placed = new Map<string, DossierDoc[]>();
  const put = (key: string, d: DossierDoc) => {
    placed.set(key, [...(placed.get(key) ?? []), d]);
  };
  const annexIds = new Set(annexes.map((a) => a.id));
  const contractIds = new Set(contracts.map((c) => c.id));
  for (const d of docs) {
    const annex = d.annexIds.find((id) => annexIds.has(id));
    const owner = d.contractIds.find((id) => contractIds.has(id));
    put(annex ? `a:${annex}` : owner ? `c:${owner}` : 'none', d);
  }
  return {
    contracts: contracts.map((c) => {
      const own = annexes
        .filter((a) => a.contractId === c.id)
        .map((a) => ({ ...a, ...shelf(placed.get(`a:${a.id}`) ?? []) }));
      const docsHere = placed.get(`c:${c.id}`) ?? [];
      const total =
        docsHere.length +
        own.reduce(
          (s, a) => s + a.docs.length + a.months.reduce((m, x) => m + x.docs.length, 0),
          0,
        );
      return { ...c, ...shelf(docsHere), annexes: own, total };
    }),
    unfiled: shelf(placed.get('none') ?? []),
  };
}

/** The "case file" of a client or payee: contracts → SOWs → documents by month (A-079). */
export const counterpartyDossier = defineService({
  name: 'documents.dossier',
  input: z.object({ party: z.enum(['client', 'payee']), id: z.uuid() }),
  handler: async (ctx, { party, id }) => {
    const dossier = await inActorScope(ctx, async (tx) => {
      const contracts = await tx
        .select({
          id: contract.id,
          kind: contract.kind,
          number: contract.number,
          status: contract.status,
          signedOn: contract.signedOn,
        })
        .from(contract)
        .where(party === 'client' ? eq(contract.clientId, id) : eq(contract.payeeId, id))
        .orderBy(sql`${contract.signedOn} desc nulls last`, asc(contract.number));
      const cIds = contracts.map((c) => c.id);
      const annexes = cIds.length
        ? await tx
            .select({
              id: contractAnnex.id,
              contractId: contractAnnex.contractId,
              kind: contractAnnex.kind,
              number: contractAnnex.number,
              title: contractAnnex.title,
              status: contractAnnex.status,
              validFrom: contractAnnex.validFrom,
            })
            .from(contractAnnex)
            .where(inArray(contractAnnex.contractId, cIds))
            .orderBy(asc(contractAnnex.validFrom), asc(contractAnnex.number))
        : [];
      const aIds = annexes.map((a) => a.id);
      const targets = [
        and(eq(documentLink.entityType, party), eq(documentLink.entityId, id)),
        cIds.length
          ? and(eq(documentLink.entityType, 'contract'), inArray(documentLink.entityId, cIds))
          : undefined,
        aIds.length
          ? and(eq(documentLink.entityType, 'contract_annex'), inArray(documentLink.entityId, aIds))
          : undefined,
      ].filter((c) => c !== undefined);
      const docIds = tx
        .selectDistinct({ id: documentLink.documentId })
        .from(documentLink)
        .where(or(...targets));
      const rows = await tx
        .select({
          id: document.id,
          type: document.type,
          number: document.number,
          title: document.title,
          docDate: document.docDate,
          status: document.status,
          fileKey: document.driveFileId,
          url: document.url,
          packageId: document.packageId,
          packagePages: document.packagePages,
        })
        .from(document)
        .where(inArray(document.id, docIds));
      const links = rows.length
        ? await tx
            .select({
              documentId: documentLink.documentId,
              entityType: documentLink.entityType,
              entityId: documentLink.entityId,
            })
            .from(documentLink)
            .where(
              and(
                inArray(
                  documentLink.documentId,
                  rows.map((r) => r.id),
                ),
                inArray(documentLink.entityType, ['contract', 'contract_annex']),
              ),
            )
        : [];
      const docs = rows.map(({ fileKey, ...r }) => {
        const own = links.filter((l) => l.documentId === r.id);
        return {
          ...r,
          hasFile: fileKey !== null,
          contractIds: own.filter((l) => l.entityType === 'contract').map((l) => l.entityId),
          annexIds: own.filter((l) => l.entityType === 'contract_annex').map((l) => l.entityId),
        };
      });
      return buildDossier(contracts, annexes, docs);
    });
    return ok(dossier);
  },
});

const AGREEMENT_TYPES = ['contract', 'sow', 'annex'];
const NUMBERED_TYPES = ['contract', 'sow', 'annex', 'invoice', 'bill', 'act'];
const UNDATED_OK = ['cv', 'other', 'package'];

export type InboxReason = 'noLinks' | 'noRecord' | 'noDate' | 'noNumber';

/**
 * Documents to sort out (A-079): not attached to anything, an agreement not attached to its
 * contract/SOW record, or missing the date or number a registry needs.
 */
export const documentInbox = defineService({
  name: 'documents.inbox',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: document.id,
          type: document.type,
          number: document.number,
          title: document.title,
          docDate: document.docDate,
          linkTypes: sql<string[]>`coalesce((select array_agg(distinct dl.entity_type)
            from public.document_link dl where dl.document_id = "document"."id"), '{}')`,
        })
        .from(document)
        .where(ne(document.status, 'void'))
        .orderBy(sql`${document.docDate} desc nulls first`, asc(document.title)),
    );
    const items = rows.flatMap((r) => {
      const reasons: InboxReason[] = [];
      if (r.linkTypes.length === 0) reasons.push('noLinks');
      else if (
        AGREEMENT_TYPES.includes(r.type) &&
        !r.linkTypes.some((t) => t === 'contract' || t === 'contract_annex')
      ) {
        reasons.push('noRecord');
      }
      if (!r.docDate && !UNDATED_OK.includes(r.type)) reasons.push('noDate');
      if (!r.number && NUMBERED_TYPES.includes(r.type)) reasons.push('noNumber');
      const { linkTypes: _, ...doc } = r;
      return reasons.length ? [{ ...doc, reasons }] : [];
    });
    return ok(items);
  },
});

/**
 * Our invoice numbers are global and act/contract numbers carry the contract, so a repeat there is
 * a real clash; SOW/annex and supplier bill numbers repeat across counterparties by design.
 */
const DUPLICATE_TYPES = ['invoice', 'act', 'contract'];

/** Gaps between the records and their documents (A-079). */
export const documentChecks = defineService({
  name: 'documents.checks',
  input: z.object({}),
  handler: async (ctx) => {
    const result = await inActorScope(ctx, async (tx) => {
      // Only the signed agreement itself (or the package holding it) counts as the record's file.
      const hasDoc = (entityType: string, idSql: ReturnType<typeof sql>, types: string[]) =>
        sql`exists (select 1 from public.document_link dl join public.document d on d.id = dl.document_id
          where dl.entity_type = ${entityType} and dl.entity_id = ${idSql} and d.status <> 'void'
            and d.type in ${types})`;
      const party = sql<
        string | null
      >`coalesce(${client.shortName}, ${client.legalName}, ${payee.legalNameUa}, ${payee.legalNameEn})`;
      const contractsWithoutFile = await tx
        .select({ id: contract.id, number: contract.number, kind: contract.kind, party })
        .from(contract)
        .leftJoin(client, eq(client.id, contract.clientId))
        .leftJoin(payee, eq(payee.id, contract.payeeId))
        .where(
          and(
            ne(contract.status, 'ended'),
            sql`not ${hasDoc('contract', sql`"contract"."id"`, ['contract', 'package'])}`,
          ),
        )
        .orderBy(asc(contract.number));
      const annexesWithoutFile = await tx
        .select({
          id: contractAnnex.id,
          contractId: contract.id,
          kind: contractAnnex.kind,
          number: contractAnnex.number,
          title: contractAnnex.title,
          contractNumber: contract.number,
        })
        .from(contractAnnex)
        .innerJoin(contract, eq(contract.id, contractAnnex.contractId))
        .where(
          and(
            ne(contractAnnex.status, 'ended'),
            sql`not ${hasDoc('contract_annex', sql`"contract_annex"."id"`, ['sow', 'annex', 'package'])}`,
          ),
        )
        .orderBy(asc(contract.number), asc(contractAnnex.number));
      // A FOP act needs a FOP contract of its payee; without one issuing it fails (A-079).
      const payeesWithoutContract = await tx
        .select({
          id: payee.id,
          name: sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn}, '')`,
        })
        .from(payee)
        .where(
          and(
            eq(payee.kind, 'fop'),
            sql`not exists (select 1 from public.contract c where c.payee_id = "payee"."id" and c.kind = 'fop')`,
          ),
        )
        .orderBy(asc(payee.legalNameUa));
      const duplicates = await tx
        .select({
          id: document.id,
          type: document.type,
          number: document.number,
          title: document.title,
          docDate: document.docDate,
          key: document.numberKey,
        })
        .from(document)
        .where(
          and(
            ne(document.status, 'void'),
            isNull(document.packageId),
            inArray(document.type, DUPLICATE_TYPES),
            sql`(${document.type}, ${document.numberKey}) in (
              select d.type, d.number_key from public.document d
              where d.status <> 'void' and d.package_id is null and d.number_key is not null
              group by d.type, d.number_key having count(*) > 1)`,
          ),
        )
        .orderBy(asc(document.type), asc(document.numberKey), asc(document.docDate));
      const groups = new Map<string, typeof duplicates>();
      for (const d of duplicates) {
        const key = `${d.type}:${d.key ?? ''}`;
        groups.set(key, [...(groups.get(key) ?? []), d]);
      }
      return {
        contractsWithoutFile,
        annexesWithoutFile,
        payeesWithoutContract,
        duplicateNumbers: [...groups.values()].map((docs) => ({
          type: docs[0]?.type ?? '',
          number: docs[0]?.number ?? '',
          docs: docs.map(({ key: _, ...d }) => d),
        })),
      };
    });
    return ok(result);
  },
});
