import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, rolePolicies } from './_common';

/** Our legal entity (TOV «SYNTORA»): headers of invoices and acts. */
export const company = pgTable(
  'company',
  {
    ...baseColumns,
    nameEn: text().notNull(),
    nameUa: text().notNull(),
    legalCode: text(),
    addressEn: text(),
    addressUa: text(),
    directorUa: text(),
    directorEn: text(),
    bankDetailsEn: text(),
    bankDetailsUa: text(),
  },
  () => [...rolePolicies('company', { read: 'finance', write: 'owner' })],
);

export const person = pgTable(
  'person',
  {
    ...baseColumns,
    fullName: text().notNull(),
    displayName: text(),
    position: text(),
    seniority: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    stack: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    domains: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    marketRateUsd: numeric({ precision: 20, scale: 8 }),
    allocation: text(),
    availabilityFrom: date({ mode: 'string' }),
    location: text(),
    timezone: text(),
    contactOwner: text(),
    status: text().notNull().default('active'),
    defaultPayeeId: uuid().references((): AnyPgColumn => payee.id, { onDelete: 'set null' }),
    notes: text(),
  },
  (t) => [
    check('person_allocation_check', sql`${t.allocation} in ('full_time', 'part_time')`),
    check('person_status_check', sql`${t.status} in ('active', 'bench', 'inactive')`),
    check('person_market_rate_check', sql`${t.marketRateUsd} >= 0`),
    index('person_stack_idx').using('gin', t.stack),
    ...rolePolicies('person', { read: 'all', write: 'finance' }),
  ],
);

/** Legal recipient of a payout: FOP, crypto wallet or other. Not always the same human as `person`. */
export const payee = pgTable(
  'payee',
  {
    ...baseColumns,
    kind: text().notNull(),
    legalNameUa: text(),
    legalNameEn: text(),
    taxId: text(),
    edrRecord: text(),
    edrDate: date({ mode: 'string' }),
    addressUa: text(),
    iban: text(),
    bankName: text(),
    walletAddress: text(),
    walletNetwork: text(),
    personId: uuid().references((): AnyPgColumn => person.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('payee_kind_check', sql`${t.kind} in ('fop', 'crypto', 'other')`),
    check('payee_name_check', sql`num_nonnulls(${t.legalNameUa}, ${t.legalNameEn}) >= 1`),
    ...rolePolicies('payee', { read: 'finance', write: 'finance' }),
  ],
);

export const client = pgTable(
  'client',
  {
    ...baseColumns,
    legalName: text().notNull(),
    shortName: text(),
    address: text(),
    country: text(),
    bankDetails: text(),
    contacts: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    defaultCurrency: text().notNull().default('USD'),
    zohoId: text(),
  },
  (t) => [
    currencyCheck('client_default_currency_check', t.defaultCurrency),
    uniqueIndex('client_zoho_id_key')
      .on(t.zohoId)
      .where(sql`${t.zohoId} is not null`),
    ...rolePolicies('client', { read: 'all', write: 'finance' }),
  ],
);

export type Company = typeof company.$inferSelect;
export type Person = typeof person.$inferSelect;
export type Payee = typeof payee.$inferSelect;
export type Client = typeof client.$inferSelect;
