import type { DbTransaction } from '@tally/db';
import { assignment, client, contract, contractAnnex, payee, person } from '@tally/db/schema';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { optionalText } from '../fields';
import { CONTRACT_STATUSES } from '../clients/schema';
import { attachedDocuments, loadAnnexes } from './annexes';

const clientLabel = sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`;
const payeeLabel = sql<string | null>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;

async function loadContracts(tx: DbTransaction, where: SQL | undefined) {
  const rows = await tx
    .select({
      contract,
      clientName: clientLabel,
      payeeName: payeeLabel,
      annexes: sql<number>`(select count(*)::int from ${contractAnnex} x
        where x.contract_id = "contract"."id")`,
      assignments: sql<number>`(select count(*)::int from ${assignment} a
        where a.contract_id = "contract"."id")`,
    })
    .from(contract)
    .leftJoin(client, eq(client.id, contract.clientId))
    .leftJoin(payee, eq(payee.id, contract.payeeId))
    .where(where)
    .orderBy(sql`${contract.signedOn} desc nulls last`, asc(contract.number));
  const docs = await attachedDocuments(
    tx,
    'contract',
    rows.map((r) => r.contract.id),
  );
  return rows.map((r) => ({ ...r, documents: docs.get(r.contract.id) ?? [] }));
}

export type ContractRow = Awaited<ReturnType<typeof loadContracts>>[number];

export const listContracts = defineService({
  name: 'contracts.list',
  input: z.object({
    clientId: z.uuid().optional(),
    payeeId: z.uuid().optional(),
    kind: z.enum(['client', 'fop']).optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    q: optionalText.describe('Contract number or counterparty name'),
  }),
  handler: async (ctx, input) => {
    const like = input.q ? `%${input.q}%` : null;
    const filters = [
      input.clientId ? eq(contract.clientId, input.clientId) : undefined,
      input.payeeId ? eq(contract.payeeId, input.payeeId) : undefined,
      input.kind ? eq(contract.kind, input.kind) : undefined,
      input.status ? eq(contract.status, input.status) : undefined,
      like
        ? or(
            ilike(contract.number, like),
            ilike(client.legalName, like),
            ilike(client.shortName, like),
            ilike(payee.legalNameUa, like),
            ilike(payee.legalNameEn, like),
          )
        : undefined,
    ];
    return ok(await inActorScope(ctx, (tx) => loadContracts(tx, and(...filters))));
  },
});

/** One contract with its documents, SOWs/annexes and the people assigned to it (A-072). */
export const getContractCard = defineService({
  name: 'contracts.card',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const card = await inActorScope(ctx, async (tx) => {
      const [row] = await loadContracts(tx, eq(contract.id, id));
      if (!row) return null;
      const annexes = await loadAnnexes(tx, eq(contractAnnex.contractId, id));
      const assignments = await tx
        .select({
          id: assignment.id,
          personId: assignment.personId,
          personName: person.fullName,
          roleTitle: assignment.roleTitle,
          annexId: assignment.annexId,
          sowRef: assignment.sowRef,
          fte: assignment.fte,
          startsOn: assignment.startsOn,
          endsOn: assignment.endsOn,
        })
        .from(assignment)
        .innerJoin(person, eq(person.id, assignment.personId))
        .where(eq(assignment.contractId, id))
        .orderBy(asc(person.fullName), desc(assignment.startsOn));
      return { ...row, annexList: annexes, assignmentList: assignments };
    });
    return card ? ok(card) : err(serviceError('not_found', 'contracts.notFound'));
  },
});
