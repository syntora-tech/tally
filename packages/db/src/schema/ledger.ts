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
import {
  baseColumns,
  currencyCheck,
  networkCheck,
  rolePolicies,
  transferFeeChecks,
  transferFeeColumns,
} from './_common';
import {
  accountKind,
  chargeMode,
  fxSource,
  plannedFrequency,
  plannedPaymentStatus,
  txType,
} from './enums';
import { invoice } from './invoices';
import { client, person } from './parties';
import { payrollItem } from './payroll';
import { reimbursement } from './trips';

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
    reimbursementId: uuid().references((): AnyPgColumn => reimbursement.id),
    plannedPaymentId: uuid().references((): AnyPgColumn => plannedPayment.id),
    fxRate: numeric({ precision: 18, scale: 6 }),
    fxSource: fxSource(),
  },
  (t) => [
    unique('allocation_legacy_ref_key').on(t.legacyRef),
    check('allocation_amount_check', sql`${t.amount} > 0`),
    check(
      'allocation_target_check',
      sql`num_nonnulls(${t.invoiceId}, ${t.payrollItemId}, ${t.reimbursementId}, ${t.plannedPaymentId}) = 1`,
    ),
    index('allocation_planned_payment_idx').on(t.plannedPaymentId),
    index('allocation_reimbursement_idx').on(t.reimbursementId),
    index('allocation_payroll_item_idx').on(t.payrollItemId),
    index('allocation_transaction_idx').on(t.transactionId),
    index('allocation_invoice_idx').on(t.invoiceId),
    ...rolePolicies('allocation', { read: 'finance', write: 'finance' }),
  ],
);

export type FxRate = typeof fxRate.$inferSelect;
export type Allocation = typeof allocation.$inferSelect;

/**
 * Recurring company costs that are not payroll (accountant, subscriptions, bank service, taxes,
 * the director's salary): the forecast and the payout calendar count them (6.1, A-067). Each month
 * becomes `planned_payment` rows that are marked paid by linking Ledger expenses (A-082).
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
    /** Whose cost it is, e.g. the director's salary (A-082). */
    personId: uuid().references(() => person.id),
    counterparty: text(),
    ...transferFeeColumns(),
  },
  (t) => [
    ...transferFeeChecks('planned_expense', t),
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

/**
 * Instalments of a planned expense within its month (A-082), e.g. the salary advance by the 22nd
 * and the rest by the 7th of the next month. `amount` null = the rest of the expense's amount.
 */
export const plannedExpensePart = pgTable(
  'planned_expense_part',
  {
    ...baseColumns,
    plannedExpenseId: uuid()
      .notNull()
      .references(() => plannedExpense.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    amount: numeric({ precision: 20, scale: 8 }),
    dueDay: integer().notNull(),
    /** 0 = due in the month itself, 1 = in the next month (salary for the second half). */
    monthOffset: integer().notNull().default(0),
    sort: integer().notNull().default(0),
  },
  (t) => [
    check('planned_expense_part_name_check', sql`length(trim(${t.name})) > 0`),
    check('planned_expense_part_amount_check', sql`${t.amount} is null or ${t.amount} > 0`),
    check('planned_expense_part_due_day_check', sql`${t.dueDay} between 1 and 31`),
    check('planned_expense_part_offset_check', sql`${t.monthOffset} between 0 and 1`),
    uniqueIndex('planned_expense_part_rest_key')
      .on(t.plannedExpenseId)
      .where(sql`${t.amount} is null`),
    index('planned_expense_part_expense_idx').on(t.plannedExpenseId),
    ...rolePolicies('planned_expense_part', { read: 'finance', write: 'finance' }),
  ],
);

/**
 * A tax or levy on a payment (A-082): on a planned expense (PIT and military levy withheld from
 * the gross salary, the social contribution on top) or on every payout to a person (20 % on top).
 * Paid the same day as its base payment.
 */
export const paymentCharge = pgTable(
  'payment_charge',
  {
    ...baseColumns,
    name: text().notNull(),
    plannedExpenseId: uuid().references(() => plannedExpense.id, { onDelete: 'cascade' }),
    personId: uuid().references(() => person.id),
    mode: chargeMode().notNull(),
    ratePercent: numeric({ precision: 9, scale: 4 }).notNull(),
    categoryId: uuid().notNull(),
    txType: txType().notNull().default('expense'),
    /** Null = the base payment's currency; a payout tax in UAH converts at the NBU rate. */
    currency: text(),
    counterparty: text(),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }),
    ...transferFeeColumns(),
  },
  (t) => [
    ...transferFeeChecks('payment_charge', t),
    foreignKey({
      name: 'payment_charge_category_type_fk',
      columns: [t.categoryId, t.txType],
      foreignColumns: [category.id, category.txType],
    }),
    check('payment_charge_type_check', sql`${t.txType} = 'expense'`),
    check('payment_charge_name_check', sql`length(trim(${t.name})) > 0`),
    check('payment_charge_rate_check', sql`${t.ratePercent} > 0 and ${t.ratePercent} <= 100`),
    check(
      'payment_charge_target_check',
      sql`num_nonnulls(${t.plannedExpenseId}, ${t.personId}) = 1`,
    ),
    // Withholding needs a gross amount, which only a planned expense has.
    check(
      'payment_charge_withheld_check',
      sql`${t.mode} = 'on_top' or ${t.plannedExpenseId} is not null`,
    ),
    check('payment_charge_period_check', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    currencyCheck('payment_charge_currency_check', t.currency),
    index('payment_charge_expense_idx').on(t.plannedExpenseId),
    index('payment_charge_person_idx').on(t.personId),
    ...rolePolicies('payment_charge', { read: 'finance', write: 'finance' }),
  ],
);

/**
 * One payment to make (A-082): an instalment of a planned expense for a month, or a charge on it,
 * or a charge on a payout (`source_allocation_id`). `status` follows its allocations: linked
 * Ledger expenses make it `paid`; `skipped` needs a reason. Amounts are snapshots of the rules.
 */
export const plannedPayment = pgTable(
  'planned_payment',
  {
    ...baseColumns,
    plannedExpenseId: uuid().references(() => plannedExpense.id),
    partId: uuid().references(() => plannedExpensePart.id, { onDelete: 'set null' }),
    chargeId: uuid().references(() => paymentCharge.id, { onDelete: 'set null' }),
    parentId: uuid().references((): AnyPgColumn => plannedPayment.id, { onDelete: 'cascade' }),
    sourceAllocationId: uuid().references((): AnyPgColumn => allocation.id, {
      onDelete: 'cascade',
    }),
    personId: uuid().references(() => person.id),
    /** First day of the month the payment is for. */
    month: date({ mode: 'string' }).notNull(),
    dueOn: date({ mode: 'string' }).notNull(),
    name: text().notNull(),
    categoryId: uuid().notNull(),
    txType: txType().notNull().default('expense'),
    counterparty: text(),
    /** Base of the charges: the gross salary of an instalment, the payout of a payout charge. */
    gross: numeric({ precision: 20, scale: 8 }),
    amount: numeric({ precision: 20, scale: 8 }).notNull(),
    currency: text().notNull(),
    feeAmount: numeric({ precision: 20, scale: 8 }),
    feeCurrency: text(),
    /** Set by hand for this month; rule edits leave it alone. */
    amountOverridden: boolean().notNull().default(false),
    status: plannedPaymentStatus().notNull().default('due'),
    skipReason: text(),
  },
  (t) => [
    foreignKey({
      name: 'planned_payment_category_type_fk',
      columns: [t.categoryId, t.txType],
      foreignColumns: [category.id, category.txType],
    }),
    check('planned_payment_type_check', sql`${t.txType} = 'expense'`),
    check('planned_payment_amount_check', sql`${t.amount} >= 0`),
    check('planned_payment_month_check', sql`extract(day from ${t.month}) = 1`),
    check(
      'planned_payment_skip_check',
      sql`(${t.status} = 'skipped') = (length(trim(coalesce(${t.skipReason}, ''))) > 0)`,
    ),
    check(
      'planned_payment_source_check',
      sql`num_nonnulls(${t.plannedExpenseId}, ${t.sourceAllocationId}) = 1`,
    ),
    currencyCheck('planned_payment_currency_check', t.currency),
    currencyCheck('planned_payment_fee_currency_check', t.feeCurrency),
    uniqueIndex('planned_payment_occurrence_key')
      .on(
        t.plannedExpenseId,
        sql`coalesce(${t.partId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.chargeId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.month,
      )
      .where(sql`${t.plannedExpenseId} is not null`),
    uniqueIndex('planned_payment_payout_charge_key')
      .on(t.sourceAllocationId, t.chargeId)
      .where(sql`${t.sourceAllocationId} is not null`),
    index('planned_payment_due_idx').on(t.dueOn),
    index('planned_payment_parent_idx').on(t.parentId),
    index('planned_payment_person_idx').on(t.personId),
    ...rolePolicies('planned_payment', { read: 'finance', write: 'finance' }),
  ],
);

export type PlannedExpense = typeof plannedExpense.$inferSelect;
export type PlannedExpensePart = typeof plannedExpensePart.$inferSelect;
export type PaymentCharge = typeof paymentCharge.$inferSelect;
export type PlannedPayment = typeof plannedPayment.$inferSelect;
