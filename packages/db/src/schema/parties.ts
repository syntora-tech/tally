import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, networkCheck, rolePolicies } from './_common';

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
    /** Place of issue in document headers (spec 7.2 doc.place_en / doc.place_ua). */
    placeEn: text().notNull().default('Odesa'),
    placeUa: text().notNull().default('м. Одеса'),
  },
  () => [...rolePolicies('company', { read: 'finance', write: 'owner' })],
);

export const person = pgTable(
  'person',
  {
    ...baseColumns,
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
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
    unique('person_legacy_ref_key').on(t.legacyRef),
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
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
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
    unique('payee_legacy_ref_key').on(t.legacyRef),
    check('payee_kind_check', sql`${t.kind} in ('fop', 'crypto', 'other')`),
    check('payee_name_check', sql`num_nonnulls(${t.legalNameUa}, ${t.legalNameEn}) >= 1`),
    networkCheck('payee_wallet_network_check', t.walletNetwork),
    ...rolePolicies('payee', { read: 'finance', write: 'finance' }),
  ],
);

export const client = pgTable(
  'client',
  {
    ...baseColumns,
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
    legalName: text().notNull(),
    shortName: text(),
    address: text(),
    country: text(),
    bankDetails: text(),
    contacts: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    defaultCurrency: text().notNull().default('USD'),
  },
  (t) => [
    unique('client_legacy_ref_key').on(t.legacyRef),
    currencyCheck('client_default_currency_check', t.defaultCurrency),
    ...rolePolicies('client', { read: 'all', write: 'finance' }),
  ],
);

/**
 * Crypto wallets of the people and clients we settle with in crypto; several per owner. The
 * Ledger matches transaction counterparties by (network, address), so an address has one owner.
 * Wallets are deactivated rather than deleted to keep old transactions identifiable.
 */
export const cryptoWallet = pgTable(
  'crypto_wallet',
  {
    ...baseColumns,
    personId: uuid().references(() => person.id, { onDelete: 'cascade' }),
    clientId: uuid().references(() => client.id, { onDelete: 'cascade' }),
    network: text().notNull(),
    /** Canonical form from `normalizeWalletAddress` (EVM lower-cased). */
    address: text().notNull(),
    label: text(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    check('crypto_wallet_owner_check', sql`num_nonnulls(${t.personId}, ${t.clientId}) = 1`),
    check(
      'crypto_wallet_address_check',
      sql`${t.address} = btrim(${t.address}) and ${t.address} <> ''`,
    ),
    networkCheck('crypto_wallet_network_check', t.network),
    unique('crypto_wallet_network_address_key').on(t.network, t.address),
    index('crypto_wallet_person_idx').on(t.personId),
    index('crypto_wallet_client_idx').on(t.clientId),
    ...rolePolicies('crypto_wallet', { read: 'finance', write: 'finance' }),
  ],
);

export type CryptoWallet = typeof cryptoWallet.$inferSelect;
export type Company = typeof company.$inferSelect;
export type Person = typeof person.$inferSelect;
export type Payee = typeof payee.$inferSelect;
export type Client = typeof client.$inferSelect;
