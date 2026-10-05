import type { DbTransaction } from '@tally/db';
import {
  assignment,
  client,
  contract,
  invoice,
  payee,
  person,
  supplierAct,
  transaction,
  trip,
  type LinkEntityType,
} from '@tally/db/schema';
import { desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

export type LinkTarget = { id: string; label: string };

type Lookup = { ids: string[] } | { q: string | null; limit: number };

const like = (q: string) => `%${q}%`;

/**
 * One catalog of the records a document can be linked to (6.9): their human labels by id, or a
 * search by text. RLS applies, so records the user cannot see are simply missing.
 */
export async function lookupLinkTargets(
  tx: DbTransaction,
  type: LinkEntityType,
  lookup: Lookup,
): Promise<LinkTarget[]> {
  const byIds = 'ids' in lookup;
  if (byIds && !lookup.ids.length) return [];
  const limit = byIds ? lookup.ids.length : lookup.limit;
  const text = byIds ? null : lookup.q;

  switch (type) {
    case 'person': {
      const where = byIds
        ? inArray(person.id, lookup.ids)
        : text
          ? or(ilike(person.fullName, like(text)), ilike(person.displayName, like(text)))
          : undefined;
      return tx
        .select({ id: person.id, label: person.fullName })
        .from(person)
        .where(where)
        .orderBy(person.fullName)
        .limit(limit);
    }
    case 'payee': {
      const label = sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;
      const where = byIds
        ? inArray(payee.id, lookup.ids)
        : text
          ? or(
              ilike(payee.legalNameUa, like(text)),
              ilike(payee.legalNameEn, like(text)),
              ilike(payee.taxId, like(text)),
            )
          : undefined;
      return tx
        .select({ id: payee.id, label })
        .from(payee)
        .where(where)
        .orderBy(label)
        .limit(limit);
    }
    case 'client': {
      const label = sql<string>`coalesce(${client.shortName}, ${client.legalName})`;
      const where = byIds
        ? inArray(client.id, lookup.ids)
        : text
          ? or(ilike(client.legalName, like(text)), ilike(client.shortName, like(text)))
          : undefined;
      return tx
        .select({ id: client.id, label })
        .from(client)
        .where(where)
        .orderBy(label)
        .limit(limit);
    }
    case 'contract': {
      const label = sql<string>`${contract.number} || coalesce(' · ' || coalesce(${client.shortName}, ${client.legalName}), '')`;
      const where = byIds
        ? inArray(contract.id, lookup.ids)
        : text
          ? or(
              ilike(contract.number, like(text)),
              ilike(client.legalName, like(text)),
              ilike(client.shortName, like(text)),
            )
          : undefined;
      return tx
        .select({ id: contract.id, label })
        .from(contract)
        .leftJoin(client, eq(client.id, contract.clientId))
        .where(where)
        .orderBy(contract.number)
        .limit(limit);
    }
    case 'assignment': {
      const label = sql<string>`${person.fullName} || coalesce(' · ' || ${assignment.roleTitle}, '') || ' · ' || ${assignment.startsOn}`;
      const where = byIds
        ? inArray(assignment.id, lookup.ids)
        : text
          ? or(ilike(person.fullName, like(text)), ilike(assignment.roleTitle, like(text)))
          : undefined;
      return tx
        .select({ id: assignment.id, label })
        .from(assignment)
        .innerJoin(person, eq(person.id, assignment.personId))
        .where(where)
        .orderBy(person.fullName, desc(assignment.startsOn))
        .limit(limit);
    }
    case 'invoice': {
      const label = sql<string>`coalesce(${invoice.number}, 'draft') || ' · ' || coalesce(${client.shortName}, ${client.legalName}) || ' · ' || ${invoice.issueDate}`;
      const where = byIds
        ? inArray(invoice.id, lookup.ids)
        : text
          ? or(
              ilike(invoice.number, like(text)),
              ilike(client.legalName, like(text)),
              ilike(client.shortName, like(text)),
            )
          : undefined;
      return tx
        .select({ id: invoice.id, label })
        .from(invoice)
        .innerJoin(client, eq(client.id, invoice.clientId))
        .where(where)
        .orderBy(desc(invoice.issueDate))
        .limit(limit);
    }
    case 'supplier_act': {
      const label = sql<string>`coalesce(${supplierAct.number}, 'draft') || ' · ' || coalesce(${payee.legalNameUa}, ${payee.legalNameEn}) || ' · ' || ${supplierAct.actDate}`;
      const where = byIds
        ? inArray(supplierAct.id, lookup.ids)
        : text
          ? or(
              ilike(supplierAct.number, like(text)),
              ilike(payee.legalNameUa, like(text)),
              ilike(payee.legalNameEn, like(text)),
            )
          : undefined;
      return tx
        .select({ id: supplierAct.id, label })
        .from(supplierAct)
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .where(where)
        .orderBy(desc(supplierAct.actDate))
        .limit(limit);
    }
    case 'trip': {
      const label = sql<string>`${trip.title} || coalesce(' · ' || ${trip.location}, '')`;
      const where = byIds
        ? inArray(trip.id, lookup.ids)
        : text
          ? or(ilike(trip.title, like(text)), ilike(trip.location, like(text)))
          : undefined;
      return tx
        .select({ id: trip.id, label })
        .from(trip)
        .where(where)
        .orderBy(sql`${trip.startsOn} desc nulls last`, trip.title)
        .limit(limit);
    }
    case 'transaction': {
      const label = sql<string>`${transaction.occurredOn} || ' · ' || coalesce(${transaction.description}, ${transaction.counterparty}, ${transaction.type}::text)`;
      const where = byIds
        ? inArray(transaction.id, lookup.ids)
        : text
          ? or(
              ilike(transaction.description, like(text)),
              ilike(transaction.counterparty, like(text)),
              ilike(transaction.externalRef, like(text)),
            )
          : undefined;
      return tx
        .select({ id: transaction.id, label })
        .from(transaction)
        .where(where)
        .orderBy(desc(transaction.occurredOn))
        .limit(limit);
    }
  }
}
