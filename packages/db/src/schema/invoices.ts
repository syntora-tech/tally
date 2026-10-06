import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { baseColumns, currencyCheck, isOwnerOrFinance, rolePolicies } from './_common';
import { contract, contractAnnex, period, timesheet } from './engagements';
import { invoiceStatus } from './enums';
import { client } from './parties';
import { document } from './documents';

/**
 * Client invoice (spec 4.2, 6.5). One invoice = one contract × period. Once issued it is an
 * immutable snapshot (I1); the number is issued only then (I2) on a working day (I3).
 */
export const invoice = pgTable(
  'invoice',
  {
    ...baseColumns,
    legacyRef: text(),
    /** Historic invoices from the xlsx: exempt from I3 and the snapshot requirement (spec 8). */
    isLegacy: boolean().notNull().default(false),
    clientId: uuid()
      .notNull()
      .references(() => client.id),
    contractId: uuid()
      .notNull()
      .references(() => contract.id),
    /** Set when the date rules of this SOW/annex replace the contract's (A-072). */
    annexId: uuid().references(() => contractAnnex.id),
    periodId: uuid().references(() => period.id),
    number: text(),
    status: invoiceStatus().notNull().default('draft'),
    issueDate: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    currency: text().notNull().default('USD'),
    total: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    paidAmount: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    snapshot: jsonb(),
    gdocFileId: text(),
    pdfFileId: text(),
    dateOverrideReason: text(),
    voidReason: text(),
    /** Bad debt (5.3 rule 7, A-065): no Ledger posting, the unpaid rest is the loss. */
    writtenOffOn: date({ mode: 'string' }),
    writeOffReason: text(),
    /** Bumped on every edit of an issued, still unpaid invoice (owner decision, A-044). */
    revision: integer().notNull().default(1),
  },
  (t) => [
    unique('invoice_legacy_ref_key').on(t.legacyRef),
    // I2: issued numbers are unique; drafts have none.
    // Deferrable in SQL so signed-number reconciliations can atomically swap numbers.
    unique('invoice_number_key').on(t.number),
    check('invoice_draft_number_check', sql`${t.status} <> 'draft' or ${t.number} is null`),
    check('invoice_issued_number_check', sql`${t.status} = 'draft' or ${t.number} is not null`),
    check(
      'invoice_void_reason_check',
      sql`${t.status} <> 'void' or length(trim(coalesce(${t.voidReason}, ''))) > 0`,
    ),
    check(
      'invoice_write_off_check',
      sql`${t.status} <> 'written_off' or (${t.writtenOffOn} is not null and length(trim(coalesce(${t.writeOffReason}, ''))) > 0)`,
    ),
    check('invoice_amounts_check', sql`${t.total} >= 0 and ${t.paidAmount} >= 0`),
    check('invoice_due_check', sql`${t.dueDate} >= ${t.issueDate}`),
    currencyCheck('invoice_currency_check', t.currency),
    index('invoice_client_idx').on(t.clientId),
    index('invoice_period_idx').on(t.periodId),
    ...rolePolicies('invoice', { read: 'finance', write: 'finance' }),
  ],
);

export const invoiceLine = pgTable(
  'invoice_line',
  {
    ...baseColumns,
    invoiceId: uuid()
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    /** Hours behind the line; manual lines (consulting, fixed services) have none. */
    timesheetId: uuid().references(() => timesheet.id),
    position: integer().notNull(),
    descriptionEn: text().notNull(),
    descriptionUa: text().notNull(),
    quantity: numeric({ precision: 10, scale: 2 }).notNull(),
    unitPrice: numeric({ precision: 20, scale: 8 }).notNull(),
    amount: numeric({ precision: 20, scale: 8 }).notNull(),
  },
  (t) => [
    unique('invoice_line_timesheet_key').on(t.timesheetId),
    unique('invoice_line_position_key').on(t.invoiceId, t.position),
    check(
      'invoice_line_amounts_check',
      sql`${t.quantity} >= 0 and ${t.unitPrice} >= 0 and ${t.amount} >= 0`,
    ),
    ...rolePolicies('invoice_line', { read: 'finance', write: 'finance' }),
  ],
);

/** Previous states of an issued invoice, written by the DB on every revision (append-only). */
export const invoiceRevision = pgTable(
  'invoice_revision',
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    revision: integer().notNull(),
    issueDate: date({ mode: 'string' }).notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
    total: numeric({ precision: 20, scale: 8 }).notNull(),
    snapshot: jsonb(),
    pdfFileId: text(),
    reason: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid().default(sql`auth.uid()`),
  },
  (t) => [
    unique('invoice_revision_key').on(t.invoiceId, t.revision),
    pgPolicy('invoice_revision_select', {
      for: 'select',
      to: authenticatedRole,
      using: isOwnerOrFinance,
    }),
  ],
).enableRLS();

export type Invoice = typeof invoice.$inferSelect;
export type InvoiceRevision = typeof invoiceRevision.$inferSelect;
export type InvoiceLine = typeof invoiceLine.$inferSelect;

/** Append-only proof of owner-authorized corrections; inserts are restricted to the DB function. */
export const invoiceNumberCorrection = pgTable(
  'invoice_number_correction',
  {
    ...baseColumns,
    invoiceId: uuid()
      .notNull()
      .references(() => invoice.id),
    signedDocumentId: uuid()
      .notNull()
      .references(() => document.id),
    oldNumber: text().notNull(),
    newNumber: text().notNull(),
    reason: text().notNull(),
    transactionId: text()
      .notNull()
      .default(sql`pg_current_xact_id()::text`),
  },
  () => [
    pgPolicy('invoice_number_correction_select', {
      for: 'select',
      to: authenticatedRole,
      using: isOwnerOrFinance,
    }),
  ],
).enableRLS();
