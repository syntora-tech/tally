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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, rolePolicies } from './_common';
import { document } from './documents';
import { fxSource } from './enums';
import { adjustment } from './payroll';
import { payee, person } from './parties';
import { transaction } from './ledger';

/**
 * Business trip (6.8). Its status is derived from the dates and what is left to reimburse
 * (A-070), so it is not stored. Legacy trips may lack dates until the owner fills them in.
 */
export const trip = pgTable(
  'trip',
  {
    ...baseColumns,
    legacyRef: text(),
    title: text().notNull(),
    location: text(),
    startsOn: date({ mode: 'string' }),
    endsOn: date({ mode: 'string' }),
    notes: text(),
  },
  (t) => [
    unique('trip_legacy_ref_key').on(t.legacyRef),
    check('trip_title_check', sql`length(trim(${t.title})) > 0`),
    check(
      'trip_dates_check',
      sql`(${t.legacyRef} is not null or (${t.startsOn} is not null and ${t.endsOn} is not null)) and (${t.endsOn} is null or ${t.startsOn} is null or ${t.endsOn} >= ${t.startsOn})`,
    ),
    ...rolePolicies('trip', { read: 'all', write: 'finance' }),
  ],
);

export const tripParticipant = pgTable(
  'trip_participant',
  {
    ...baseColumns,
    tripId: uuid()
      .notNull()
      .references(() => trip.id, { onDelete: 'cascade' }),
    personId: uuid()
      .notNull()
      .references(() => person.id),
  },
  (t) => [
    unique('trip_participant_key').on(t.tripId, t.personId),
    index('trip_participant_person_idx').on(t.personId),
    ...rolePolicies('trip_participant', { read: 'all', write: 'finance' }),
  ],
);

/**
 * One expense of a participant (6.8). `fx_rate` = UAH per unit (NBU on the date by default);
 * a company-paid expense is booked in the Ledger (`transaction_id`) and is never reimbursed.
 */
export const tripExpense = pgTable(
  'trip_expense',
  {
    ...baseColumns,
    legacyRef: text(),
    tripId: uuid().notNull(),
    personId: uuid().notNull(),
    spentOn: date({ mode: 'string' }),
    description: text().notNull(),
    amount: numeric({ precision: 20, scale: 8 }).notNull(),
    currency: text().notNull(),
    fxRate: numeric({ precision: 18, scale: 6 }).notNull(),
    fxSource: fxSource().notNull().default('nbu'),
    amountUah: numeric({ precision: 20, scale: 2 }).notNull(),
    amountUsd: numeric({ precision: 20, scale: 8 }).notNull(),
    reimbursable: boolean().notNull().default(true),
    paidBy: text().notNull().default('person'),
    receiptDocumentId: uuid().references(() => document.id, { onDelete: 'set null' }),
    transactionId: uuid().references(() => transaction.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('trip_expense_legacy_ref_key').on(t.legacyRef),
    // The payer must take part in the trip.
    foreignKey({
      name: 'trip_expense_participant_fk',
      columns: [t.tripId, t.personId],
      foreignColumns: [tripParticipant.tripId, tripParticipant.personId],
    }).onDelete('cascade'),
    check('trip_expense_amount_check', sql`${t.amount} > 0 and ${t.fxRate} > 0`),
    check('trip_expense_paid_by_check', sql`${t.paidBy} in ('person', 'company')`),
    check('trip_expense_company_check', sql`${t.paidBy} = 'person' or not ${t.reimbursable}`),
    check(
      'trip_expense_spent_on_check',
      sql`${t.spentOn} is not null or ${t.legacyRef} is not null`,
    ),
    check('trip_expense_description_check', sql`length(trim(${t.description})) > 0`),
    currencyCheck('trip_expense_currency_check', t.currency),
    uniqueIndex('trip_expense_transaction_key')
      .on(t.transactionId)
      .where(sql`${t.transactionId} is not null`),
    index('trip_expense_trip_idx').on(t.tripId),
    ...rolePolicies('trip_expense', { read: 'finance', write: 'finance' }),
  ],
);

/**
 * Money returned to a participant for a trip (6.8, A-070), in UAH: through the monthly payout
 * (`payroll`, an adjustment), an extra FOP act (`act`) or a direct payment. `status = paid` marks
 * a reimbursement settled outside Tally (legacy); otherwise it is paid once its money moved.
 */
export const reimbursement = pgTable(
  'reimbursement',
  {
    ...baseColumns,
    legacyRef: text(),
    tripId: uuid().notNull(),
    personId: uuid().notNull(),
    payeeId: uuid().references(() => payee.id),
    amount: numeric({ precision: 20, scale: 2 }).notNull(),
    currency: text().notNull().default('UAH'),
    method: text().notNull(),
    status: text().notNull().default('planned'),
    adjustmentId: uuid().references(() => adjustment.id, { onDelete: 'set null' }),
    notes: text(),
  },
  (t) => [
    unique('reimbursement_legacy_ref_key').on(t.legacyRef),
    foreignKey({
      name: 'reimbursement_participant_fk',
      columns: [t.tripId, t.personId],
      foreignColumns: [tripParticipant.tripId, tripParticipant.personId],
    }).onDelete('cascade'),
    check('reimbursement_amount_check', sql`${t.amount} > 0`),
    check('reimbursement_currency_check', sql`${t.currency} = 'UAH'`),
    check('reimbursement_method_check', sql`${t.method} in ('payroll', 'act', 'direct_payment')`),
    check('reimbursement_status_check', sql`${t.status} in ('planned', 'paid')`),
    check('reimbursement_payee_check', sql`${t.method} <> 'act' or ${t.payeeId} is not null`),
    index('reimbursement_trip_idx').on(t.tripId),
    ...rolePolicies('reimbursement', { read: 'finance', write: 'finance' }),
  ],
);

export type Trip = typeof trip.$inferSelect;
export type TripExpense = typeof tripExpense.$inferSelect;
export type Reimbursement = typeof reimbursement.$inferSelect;
