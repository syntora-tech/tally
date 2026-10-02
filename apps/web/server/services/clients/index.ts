import { assignment, client, company, contract, payee, person } from '@tally/db/schema';
import { and, asc, count, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { walletsOf } from '../wallets';
import { clientInput, contractInput } from './schema';

export const clientName = sql<string>`coalesce(${client.shortName}, ${client.legalName})`;
// Left-joined counterparties: exactly one of these is null for any contract (I9).
const joinedClientName = sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`;
const joinedPayeeName = sql<string | null>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;

export const listClients = defineService({
  name: 'clients.list',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: client.id,
          legalName: client.legalName,
          shortName: client.shortName,
          country: client.country,
          defaultCurrency: client.defaultCurrency,
          contracts: count(contract.id),
        })
        .from(client)
        .leftJoin(contract, eq(contract.clientId, client.id))
        .groupBy(client.id)
        .orderBy(asc(clientName)),
    );
    const wallets = await inActorScope(ctx, (tx) =>
      walletsOf(tx, { clientIds: rows.map((r) => r.id) }),
    );
    return ok(
      rows.map((r) => ({
        ...r,
        wallets: wallets
          .filter((w) => w.clientId === r.id)
          .map(({ id, network, address, label, isActive }) => ({
            id,
            network,
            address,
            label,
            isActive,
          })),
      })),
    );
  },
});

export const getClient = defineService({
  name: 'clients.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const card = await inActorScope(ctx, async (tx) => {
      const [row] = await tx.select().from(client).where(eq(client.id, id));
      if (!row) return null;
      // Contracts and assignments are finance-only by RLS; viewers get empty lists.
      const contracts = await tx
        .select({
          id: contract.id,
          number: contract.number,
          signedOn: contract.signedOn,
          currency: contract.currency,
          status: contract.status,
        })
        .from(contract)
        .where(eq(contract.clientId, id))
        .orderBy(desc(contract.signedOn));
      const activePeople = await tx
        .select({
          assignmentId: assignment.id,
          personId: person.id,
          personName: person.fullName,
          roleTitle: assignment.roleTitle,
          sowRef: assignment.sowRef,
          contractNumber: contract.number,
          fte: assignment.fte,
        })
        .from(assignment)
        .innerJoin(contract, eq(contract.id, assignment.contractId))
        .innerJoin(person, eq(person.id, assignment.personId))
        .where(
          and(
            eq(contract.clientId, id),
            sql`${assignment.startsOn} <= ${ctx.today}`,
            or(isNull(assignment.endsOn), gte(assignment.endsOn, ctx.today)),
          ),
        )
        .orderBy(asc(person.fullName));
      return { client: row, contracts, activePeople };
    });
    return card ? ok(card) : err(serviceError('not_found', 'clients.notFound'));
  },
});

export const createClient = defineService({
  name: 'clients.create',
  input: clientInput,
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.insert(client).values(input).returning({ id: client.id }),
    );
    return row ? ok(row) : err(serviceError('internal_error', 'clients.createFailed'));
  },
});

export const updateClient = defineService({
  name: 'clients.update',
  input: clientInput.extend({ id: z.uuid() }),
  handler: async (ctx, { id, ...input }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.update(client).set(input).where(eq(client.id, id)).returning({ id: client.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'clients.notFound'));
  },
});

export const getContract = defineService({
  name: 'contracts.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({
          contract,
          clientName: joinedClientName,
          payeeName: joinedPayeeName,
          companyName: company.nameEn,
        })
        .from(contract)
        .innerJoin(company, eq(company.id, contract.companyId))
        .leftJoin(client, eq(client.id, contract.clientId))
        .leftJoin(payee, eq(payee.id, contract.payeeId))
        .where(eq(contract.id, id)),
    );
    return row ? ok(row) : err(serviceError('not_found', 'contracts.notFound'));
  },
});

export const listPayeeContracts = defineService({
  name: 'contracts.forPayee',
  input: z.object({ payeeId: z.uuid() }),
  handler: async (ctx, { payeeId }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: contract.id,
          number: contract.number,
          signedOn: contract.signedOn,
          status: contract.status,
        })
        .from(contract)
        .where(eq(contract.payeeId, payeeId))
        .orderBy(desc(contract.signedOn)),
    );
    return ok(rows);
  },
});

const NO_COMPANY = 'company.missing';

/** Contracts always belong to our single company (v1); client XOR payee is also enforced by I9. */
export const createContract = defineService({
  name: 'contracts.create',
  input: contractInput,
  handler: async (ctx, input) => {
    const created = await inActorScope(ctx, async (tx) => {
      const [co] = await tx
        .select({ id: company.id })
        .from(company)
        .orderBy(asc(company.createdAt))
        .limit(1);
      if (!co) return null;
      const [row] = await tx
        .insert(contract)
        .values({ ...input, companyId: co.id })
        .returning({ id: contract.id });
      return row ?? null;
    });
    return created ? ok(created) : err(serviceError('conflict', NO_COMPANY));
  },
});

export const updateContract = defineService({
  name: 'contracts.update',
  input: contractInput.and(z.object({ id: z.uuid() })),
  handler: async (ctx, { id, ...input }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.update(contract).set(input).where(eq(contract.id, id)).returning({ id: contract.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'contracts.notFound'));
  },
});
