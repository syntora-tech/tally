import type { DbTransaction } from '@tally/db';
import { company, contract, contractAnnex, document, documentLink } from '@tally/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { currencyCode, optionalLocalDate, optionalText, requiredText } from '../fields';
import { definedOnly } from '../patch';
import {
  actDateRule,
  CONTRACT_STATUSES,
  contractFields,
  contractInput,
  invoiceDateRule,
  paymentDueRule,
} from '../clients/schema';
import { ANNEX_KINDS, ANNEX_STATUSES } from './annexes';

const dryRun = z.boolean().default(false).describe('Validate and preview without writing');
type Problems = Record<string, string[]>;

const documentIds = z
  .array(z.uuid())
  .max(20)
  .optional()
  .describe('Documents already in the registry to link (search_documents); never re-uploaded');

/** Links registry documents to a record; returns error keys for documents that do not exist. */
async function linkDocuments(
  tx: DbTransaction,
  entityType: 'contract' | 'contract_annex',
  entityId: string,
  ids: string[] | undefined,
): Promise<{ problems: string[]; linked: number }> {
  if (!ids?.length) return { problems: [], linked: 0 };
  const unique = [...new Set(ids)];
  const found = await tx
    .select({ id: document.id })
    .from(document)
    .where(inArray(document.id, unique));
  const known = new Set(found.map((d) => d.id));
  const problems = unique
    .filter((id) => !known.has(id))
    .map((id) => msg('documents.targetMissing', { type: 'document', id }));
  if (problems.length) return { problems, linked: 0 };
  const inserted = await tx
    .insert(documentLink)
    .values(unique.map((documentId) => ({ documentId, entityType, entityId })))
    .onConflictDoNothing()
    .returning({ id: documentLink.id });
  return { problems: [], linked: inserted.length };
}

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

// Defaults belong to creation only: a patch without the field keeps the stored value.
const contractPatch = contractFields.partial().extend({
  id: z.uuid().optional().describe('Contract id; without it matched by number + counterparty'),
  currency: currencyCode.optional(),
  paymentDueRule: paymentDueRule.optional(),
  invoiceDateRule: invoiceDateRule.optional(),
  actDateRule: actDateRule.optional(),
  status: z.enum(CONTRACT_STATUSES).optional(),
  documentIds,
});

/**
 * Client and FOP contracts in bulk (A-072): matched by id, else by number (case-insensitive) and
 * the counterparty sent; only the fields sent change, a missing contract is created.
 */
export const upsertContracts = defineService({
  name: 'contracts.upsertBatch',
  input: z.object({ contracts: z.array(contractPatch).min(1).max(50), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Problems = {};
      const results = [];
      for (const [index, { id, documentIds: docs, ...patch }] of input.contracts.entries()) {
        const key = `contracts.${String(index)}`;
        const matches = id
          ? await tx.select().from(contract).where(eq(contract.id, id))
          : patch.number
            ? await tx
                .select()
                .from(contract)
                .where(
                  and(
                    sql`lower(${contract.number}) = lower(${patch.number})`,
                    patch.clientId ? eq(contract.clientId, patch.clientId) : undefined,
                    patch.payeeId ? eq(contract.payeeId, patch.payeeId) : undefined,
                  ),
                )
            : [];
        if (matches.length > 1) {
          errors[key] = [msg('contracts.ambiguousNumber', { number: patch.number ?? '' })];
          continue;
        }
        const current = matches[0];
        let contractId: string;
        let status: 'created' | 'updated' | 'unchanged';
        let number: string;
        if (!current) {
          if (id) {
            errors[key] = ['contracts.notFound'];
            continue;
          }
          const full = contractInput.safeParse(patch);
          if (!full.success) {
            errors[key] = issues(full.error);
            continue;
          }
          const [co] = await tx
            .select({ id: company.id })
            .from(company)
            .orderBy(asc(company.createdAt))
            .limit(1);
          if (!co) return err(serviceError('conflict', 'company.missing'));
          const [row] = await tx
            .insert(contract)
            .values({ ...full.data, companyId: co.id })
            .returning({ id: contract.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          contractId = row.id;
          status = 'created';
          number = full.data.number;
        } else {
          // Matched by number, the number is the lookup key, not a change; renaming needs the id.
          const values = definedOnly(id ? patch : { ...patch, number: undefined });
          const merged = contractInput.safeParse({ ...current, ...values });
          if (!merged.success) {
            errors[key] = issues(merged.error);
            continue;
          }
          if (Object.keys(values).length) {
            await tx.update(contract).set(values).where(eq(contract.id, current.id));
          }
          contractId = current.id;
          status = Object.keys(values).length ? 'updated' : 'unchanged';
          number = values.number ?? current.number;
        }
        const { problems, linked } = await linkDocuments(tx, 'contract', contractId, docs);
        if (problems.length) {
          errors[key] = problems;
          continue;
        }
        results.push({ index, id: contractId, number, status, linkedDocuments: linked });
      }
      if (Object.keys(errors).length) {
        return err(
          serviceError(
            'validation_error',
            msg('batch.failedItems', { count: Object.keys(errors).length }),
            errors,
          ),
        );
      }
      return ok({ results });
    }),
});

const annexFields = z.object({
  contractId: z.uuid(),
  kind: z.enum(ANNEX_KINDS),
  number: requiredText('contracts.annexNumber'),
  title: optionalText,
  signedOn: optionalLocalDate,
  validFrom: optionalLocalDate,
  validTo: optionalLocalDate,
  status: z.enum(ANNEX_STATUSES).default('active'),
  paymentDueRule: paymentDueRule.nullable().default(null),
  invoiceDateRule: invoiceDateRule.nullable().default(null),
  notes: optionalText,
});

const annexPatch = annexFields.partial().extend({
  id: z
    .uuid()
    .optional()
    .describe('SOW/annex id; without it matched by contractId + kind + number'),
  status: z.enum(ANNEX_STATUSES).optional(),
  paymentDueRule: paymentDueRule
    .nullable()
    .optional()
    .describe("Replaces the contract's payment term for this SOW; null = use the contract's"),
  invoiceDateRule: invoiceDateRule
    .nullable()
    .optional()
    .describe("Replaces the contract's invoice date rule for this SOW; null = use the contract's"),
  documentIds,
});

/** SOWs/annexes in bulk (A-072), keyed like contracts; each result carries the id for assignments. */
export const upsertContractAnnexes = defineService({
  name: 'contracts.annexes.upsertBatch',
  input: z.object({ annexes: z.array(annexPatch).min(1).max(100), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Problems = {};
      const results = [];
      for (const [index, { id, documentIds: docs, ...patch }] of input.annexes.entries()) {
        const key = `annexes.${String(index)}`;
        const [current] = id
          ? await tx.select().from(contractAnnex).where(eq(contractAnnex.id, id))
          : patch.contractId && patch.kind && patch.number
            ? await tx
                .select()
                .from(contractAnnex)
                .where(
                  and(
                    eq(contractAnnex.contractId, patch.contractId),
                    eq(contractAnnex.kind, patch.kind),
                    sql`lower(${contractAnnex.number}) = lower(${patch.number})`,
                  ),
                )
            : [];
        let annexId: string;
        let status: 'created' | 'updated' | 'unchanged';
        if (!current) {
          if (id) {
            errors[key] = ['contracts.annexNotFound'];
            continue;
          }
          const full = annexFields.safeParse(patch);
          if (!full.success) {
            errors[key] = issues(full.error);
            continue;
          }
          const [parent] = await tx
            .select({ id: contract.id })
            .from(contract)
            .where(eq(contract.id, full.data.contractId));
          if (!parent) {
            errors[key] = ['contracts.notFound'];
            continue;
          }
          const [row] = await tx
            .insert(contractAnnex)
            .values(full.data)
            .returning({ id: contractAnnex.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          annexId = row.id;
          status = 'created';
        } else {
          const values = definedOnly(id ? patch : { ...patch, number: undefined });
          const merged = annexFields.safeParse({ ...current, ...values });
          if (!merged.success) {
            errors[key] = issues(merged.error);
            continue;
          }
          if (Object.keys(values).length) {
            await tx.update(contractAnnex).set(values).where(eq(contractAnnex.id, current.id));
          }
          annexId = current.id;
          status = Object.keys(values).length ? 'updated' : 'unchanged';
        }
        const { problems, linked } = await linkDocuments(tx, 'contract_annex', annexId, docs);
        if (problems.length) {
          errors[key] = problems;
          continue;
        }
        const [row] = await tx.select().from(contractAnnex).where(eq(contractAnnex.id, annexId));
        results.push({
          index,
          id: annexId,
          contractId: row?.contractId,
          kind: row?.kind,
          number: row?.number,
          status,
          linkedDocuments: linked,
        });
      }
      if (Object.keys(errors).length) {
        return err(
          serviceError(
            'validation_error',
            msg('batch.failedItems', { count: Object.keys(errors).length }),
            errors,
          ),
        );
      }
      return ok({ results });
    }),
});
