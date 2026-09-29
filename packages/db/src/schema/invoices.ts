import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, rolePolicies } from './_common';
import { contract, period, timesheet } from './engagements';
import { invoiceStatus } from './enums';
import { client } from './parties';

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
  },
  (t) => [
    unique('invoice_legacy_ref_key').on(t.legacyRef),
    // I2: issued numbers are unique; drafts have none.
    uniqueIndex('invoice_number_key')
      .on(t.number)
      .where(sql`${t.status} <> 'draft'`),
    check('invoice_draft_number_check', sql`${t.status} <> 'draft' or ${t.number} is null`),
    check('invoice_issued_number_check', sql`${t.status} = 'draft' or ${t.number} is not null`),
    check(
      'invoice_void_reason_check',
      sql`${t.status} <> 'void' or length(trim(coalesce(${t.voidReason}, ''))) > 0`,
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

export type Invoice = typeof invoice.$inferSelect;
export type InvoiceLine = typeof invoiceLine.$inferSelect;
