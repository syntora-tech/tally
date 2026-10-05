import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, networkCheck, rolePolicies } from './_common';
import { accountKind, fxSource, plannedFrequency, txType } from './enums';
import { invoice } from './invoices';
import { client, person } from './parties';
import { payrollItem } from './payroll';

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
    /** Our own wallet address, canonical form (`normalizeWalletAddress`); identifies transfers. */
    address: text(),
    openingBalance: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    openingDate: date({ mode: 'string' }).notNull(),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    unique('account_legacy_ref_key').on(t.legacyRef),
    unique('account_name_key').on(t.name),
    currencyCheck('account_currency_check', t.currency),
    networkCheck('account_network_check', t.network),
    check('account_address_network_check', sql`${t.address} is null or ${t.network} is not null`),
    uniqueIndex('account_network_address_key')
      .on(t.network, t.address)
      .where(sql`${t.address} is not null`),
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
    /** Who the money came from / went to (A-061); at most one of person and client. */
    personId: uuid().references(() => person.id, { onDelete: 'set null' }),
    clientId: uuid().references(() => client.id, { onDelete: 'set null' }),
    /** Counterparty wallet of a crypto transaction, canonical form; matched to `crypto_wallet`. */
    counterpartyAddress: text(),
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
    check('transaction_party_check', sql`num_nonnulls(${t.personId}, ${t.clientId}) <= 1`),
    index('transaction_person_idx').on(t.personId),
    index('transaction_client_idx').on(t.clientId),
    index('transaction_counterparty_address_idx').on(t.counterpartyAddress),
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

/** Daily rates (5.4): `rate` = units of `quote` per 1 `base`, e.g. USD→UAH 44.48. */
export const fxRate = pgTable(
  'fx_rate',
  {
    ...baseColumns,
    onDate: date({ mode: 'string' }).notNull(),
    base: text().notNull(),
    quote: text().notNull(),
    rate: numeric({ precision: 18, scale: 6 }).notNull(),
    source: fxSource().notNull(),
  },
  (t) => [
    unique('fx_rate_key').on(t.onDate, t.base, t.quote, t.source),
    check('fx_rate_positive_check', sql`${t.rate} > 0`),
    currencyCheck('fx_rate_base_check', t.base),
    currencyCheck('fx_rate_quote_check', t.quote),
    ...rolePolicies('fx_rate', { read: 'finance', write: 'finance' }),
  ],
);

/**
 * Links money in the Ledger to what it settles (I7, I9). `amount` is in the target's currency;
 * when the transaction's currency differs, `fx_rate` = transaction units per 1 target unit.
 */
export const allocation = pgTable(
  'allocation',
  {
    ...baseColumns,
    legacyRef: text(),
    transactionId: uuid()
      .notNull()
      .references(() => transaction.id, { onDelete: 'cascade' }),
    amount: numeric({ precision: 20, scale: 8 }).notNull(),
    currency: text().notNull(),
    invoiceId: uuid().references(() => invoice.id),
    payrollItemId: uuid().references((): AnyPgColumn => payrollItem.id),
    fxRate: numeric({ precision: 18, scale: 6 }),
    fxSource: fxSource(),
  },
  (t) => [
    unique('allocation_legacy_ref_key').on(t.legacyRef),
    check('allocation_amount_check', sql`${t.amount} > 0`),
    check('allocation_target_check', sql`num_nonnulls(${t.invoiceId}, ${t.payrollItemId}) = 1`),
    index('allocation_payroll_item_idx').on(t.payrollItemId),
    index('allocation_transaction_idx').on(t.transactionId),
    index('allocation_invoice_idx').on(t.invoiceId),
    ...rolePolicies('allocation', { read: 'finance', write: 'finance' }),
  ],
);

export type FxRate = typeof fxRate.$inferSelect;
export type Allocation = typeof allocation.$inferSelect;

/**
 * Recurring company costs that are not payroll (accountant, subscriptions, bank service, taxes):
 * the forecast and the payout calendar count them (6.1, A-067). Plans, not money: no postings.
 */
export const plannedExpense = pgTable(
  'planned_expense',
  {
    ...baseColumns,
    name: text().notNull(),
    categoryId: uuid().notNull(),
    txType: txType().notNull().default('expense'),
    amount: numeric({ precision: 20, scale: 8 }).notNull(),
    currency: text().notNull(),
    frequency: plannedFrequency().notNull().default('monthly'),
    anchorMonth: integer(),
    dueDay: integer(),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }),
    notes: text(),
  },
  (t) => [
    foreignKey({
      name: 'planned_expense_category_type_fk',
      columns: [t.categoryId, t.txType],
      foreignColumns: [category.id, category.txType],
    }),
    check('planned_expense_type_check', sql`${t.txType} = 'expense'`),
    check('planned_expense_name_check', sql`length(trim(${t.name})) > 0`),
    check('planned_expense_amount_check', sql`${t.amount} > 0`),
    check(
      'planned_expense_anchor_check',
      sql`(${t.frequency} = 'monthly') = (${t.anchorMonth} is null) and coalesce(${t.anchorMonth}, 1) between 1 and 12`,
    ),
    check('planned_expense_due_day_check', sql`coalesce(${t.dueDay}, 1) between 1 and 31`),
    check('planned_expense_period_check', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    currencyCheck('planned_expense_currency_check', t.currency),
    ...rolePolicies('planned_expense', { read: 'finance', write: 'finance' }),
  ],
);
