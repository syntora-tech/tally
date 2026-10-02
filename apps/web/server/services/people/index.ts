import type { DbTransaction } from '@tally/db';
import { payee, person } from '@tally/db/schema';
import { benchStatusForLoad, type BenchStatus, type LocalDate } from '@tally/domain';
import { and, asc, eq, ilike, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { walletsOf, type WalletRow } from '../wallets';
import { peopleFilters, personProfileInput, type PeopleFilters } from './schema';

export type PersonRow = typeof person.$inferSelect & { load: string; bench: BenchStatus };

async function loadsOn(tx: DbTransaction, on: LocalDate): Promise<Map<string, string>> {
  const rows = await tx.execute<{ person_id: string; load: string }>(
    sql`select person_id, load::text as load from public.person_bench_load(${on})`,
  );
  return new Map(rows.map((r) => [r.person_id, r.load]));
}

function withBench(p: typeof person.$inferSelect, loads: Map<string, string>): PersonRow {
  const load = loads.get(p.id) ?? '0';
  return { ...p, load, bench: benchStatusForLoad(load) };
}

function filterConditions(f: PeopleFilters): SQL[] {
  const conditions: SQL[] = [];
  if (f.q) {
    const like = `%${f.q}%`;
    const text = or(
      ilike(person.fullName, like),
      ilike(person.displayName, like),
      ilike(person.position, like),
    );
    if (text) conditions.push(text);
  }
  for (const tag of f.stack) {
    conditions.push(
      sql`exists (select 1 from unnest(${person.stack}) s where lower(s) = lower(${tag}))`,
    );
  }
  if (f.seniority) {
    conditions.push(
      sql`exists (select 1 from unnest(${person.seniority}) s where lower(s) = lower(${f.seniority}))`,
    );
  }
  if (f.maxRate) conditions.push(lte(person.marketRateUsd, f.maxRate));
  if (f.availableOn) {
    const available = or(
      isNull(person.availabilityFrom),
      lte(person.availabilityFrom, f.availableOn),
    );
    if (available) conditions.push(available);
    conditions.push(ne(person.status, 'inactive'));
  }
  if (f.allocation) conditions.push(eq(person.allocation, f.allocation));
  if (f.location) conditions.push(ilike(person.location, `%${f.location}%`));
  if (f.status) conditions.push(eq(person.status, f.status));
  return conditions;
}

/** Bench list with filters from spec 6.2; bench status is computed for `ctx.today`. */
export const searchPeople = defineService({
  name: 'people.search',
  input: peopleFilters,
  handler: async (ctx, filters) => {
    const rows = await inActorScope(ctx, async (tx) => {
      const loads = await loadsOn(tx, ctx.today);
      const people = await tx
        .select()
        .from(person)
        .where(and(...filterConditions(filters)))
        .orderBy(asc(person.fullName));
      return people.map((p) => withBench(p, loads));
    });
    return ok(filters.bench ? rows.filter((r) => r.bench === filters.bench) : rows);
  },
});

export type PersonCard = PersonRow & {
  /** Null for roles that cannot read payees (viewer) or when unset. */
  defaultPayee: { id: string; name: string } | null;
  /** Crypto wallets (A-060); empty for roles that cannot read them. */
  wallets: WalletRow[];
};

const walletRow = ({ id, network, address, label, isActive }: WalletRow): WalletRow => ({
  id,
  network,
  address,
  label,
  isActive,
});

export const getPerson = defineService({
  name: 'people.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const card = await inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select({
          person,
          payeeId: payee.id,
          payeeName: sql<string | null>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`,
        })
        .from(person)
        .leftJoin(payee, eq(payee.id, person.defaultPayeeId))
        .where(eq(person.id, id));
      if (!row) return null;
      const loads = await loadsOn(tx, ctx.today);
      return {
        ...withBench(row.person, loads),
        defaultPayee: row.payeeId ? { id: row.payeeId, name: row.payeeName ?? '' } : null,
        wallets: (await walletsOf(tx, { personIds: [id] })).map(walletRow),
      } satisfies PersonCard;
    });
    return card ? ok(card) : err(serviceError('not_found', 'people.notFound'));
  },
});

export const createPerson = defineService({
  name: 'people.create',
  input: personProfileInput,
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.insert(person).values(input).returning({ id: person.id }),
    );
    return row ? ok(row) : err(serviceError('internal_error', 'general.createFailed'));
  },
});

export const updatePerson = defineService({
  name: 'people.update',
  input: personProfileInput.extend({ id: z.uuid() }),
  handler: async (ctx, { id, ...input }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.update(person).set(input).where(eq(person.id, id)).returning({ id: person.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'people.notFound'));
  },
});
