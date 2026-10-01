import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, rolePolicies } from './_common';
import { accountKind, txType } from './enums';

/** Bank account, wallet or cash box (spec 6.7); balance = opening + Σ postings. */
export const account = pgTable(
  'account',
  {
    ...baseColumns,
    legacyRef: text(),
    name: text().notNull(),
    kind: accountKind().notNull(),
    currency: text().notNull(),
    /** Blockchain network for crypto wallets, e.g. ETH, TRON. */
    network: text(),
    openingBalance: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    openingDate: date({ mode: 'string' }).notNull(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('account_legacy_ref_key').on(t.legacyRef),
    unique('account_name_key').on(t.name),
    currencyCheck('account_currency_check', t.currency),
    ...rolePolicies('account', { read: 'finance', write: 'finance' }),
  ],
);

export const category = pgTable(
  'category',
  {
    ...baseColumns,
    txType: txType().notNull(),
    name: text().notNull(),
  },
  (t) => [
    unique('category_type_name_key').on(t.txType, t.name),
    // Target of the composite FK that keeps a transaction's category of its own type.
    unique('category_id_type_key').on(t.id, t.txType),
    check('category_name_check', sql`length(trim(${t.name})) > 0`),
    ...rolePolicies('category', { read: 'finance', write: 'finance' }),
  ],
);

/** One business event; its money movements are postings (I5 checks their shape). */
export const transaction = pgTable(
  'transaction',
  {
    ...baseColumns,
    legacyRef: text(),
    occurredOn: date({ mode: 'string' }).notNull(),
    type: txType().notNull(),
    categoryId: uuid().notNull(),
    description: text(),
    counterparty: text(),
    /** Bank reference or transaction hash; used for statement de-duplication (stage 4). */
    externalRef: text(),
  },
  (t) => [
    unique('transaction_legacy_ref_key').on(t.legacyRef),
    foreignKey({
      name: 'transaction_category_type_fk',
      columns: [t.categoryId, t.type],
      foreignColumns: [category.id, category.txType],
    }),
    index('transaction_occurred_on_idx').on(t.occurredOn),
    index('transaction_external_ref_idx').on(t.externalRef),
    ...rolePolicies('transaction', { read: 'finance', write: 'finance' }),
  ],
);

/** Signed amount on one account in its currency (I4); fees are separate negative postings. */
export const posting = pgTable(
  'posting',
  {
    ...baseColumns,
    transactionId: uuid()
      .notNull()
      .references(() => transaction.id, { onDelete: 'cascade' }),
    accountId: uuid()
      .notNull()
      .references(() => account.id),
    amount: numeric({ precision: 20, scale: 8 }).notNull(),
    currency: text().notNull(),
    isFee: boolean().notNull().default(false),
  },
  (t) => [
    check('posting_amount_check', sql`${t.amount} <> 0`),
    index('posting_transaction_idx').on(t.transactionId),
    index('posting_account_idx').on(t.accountId),
    ...rolePolicies('posting', { read: 'finance', write: 'finance' }),
  ],
);

export type Account = typeof account.$inferSelect;
export type Category = typeof category.$inferSelect;
export type Transaction = typeof transaction.$inferSelect;
export type Posting = typeof posting.$inferSelect;
