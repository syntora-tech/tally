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
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, rolePolicies } from './_common';
import { document } from './documents';
import { contract } from './engagements';
import { docStatus } from './enums';
import { payee } from './parties';
import { payrollItem } from './payroll';

/**
 * Invoice a contractor who is not a FOP issues to us for a month of work (A-090), drafted from
 * their payout and rendered from our template; once issued it is immutable like an act (I1).
 */
export const contractorInvoice = pgTable(
  'contractor_invoice',
  {
    ...baseColumns,
    contractId: uuid()
      .notNull()
      .references(() => contract.id),
    payeeId: uuid()
      .notNull()
      .references(() => payee.id),
    payrollItemId: uuid().references(() => payrollItem.id, { onDelete: 'cascade' }),
    number: text(),
    invoiceDate: date({ mode: 'string' }).notNull(),
    periodFrom: date({ mode: 'string' }),
    periodTo: date({ mode: 'string' }),
    hours: numeric({ precision: 10, scale: 2 }),
    amount: numeric({ precision: 20, scale: 2 }).notNull(),
    currency: text().notNull().default('USD'),
    descriptionEn: text().notNull(),
    descriptionUa: text().notNull(),
    status: docStatus().notNull().default('draft'),
    snapshot: jsonb(),
    gdocFileId: text(),
    pdfFileId: text(),
    documentId: uuid().references(() => document.id, { onDelete: 'set null' }),
    voidReason: text(),
  },
  (t) => [
    uniqueIndex('contractor_invoice_number_key')
      .on(t.payeeId, t.number)
      .where(sql`${t.status} <> 'draft'`),
    uniqueIndex('contractor_invoice_payout_key')
      .on(t.payrollItemId)
      .where(sql`${t.status} <> 'void'`),
    check(
      'contractor_invoice_draft_number_check',
      sql`${t.status} <> 'draft' or ${t.number} is null`,
    ),
    check(
      'contractor_invoice_issued_number_check',
      sql`${t.status} = 'draft' or ${t.number} is not null`,
    ),
    check('contractor_invoice_amount_check', sql`${t.amount} >= 0`),
    check('contractor_invoice_hours_check', sql`${t.hours} is null or ${t.hours} >= 0`),
    check(
      'contractor_invoice_period_check',
      sql`${t.periodFrom} is null or ${t.periodTo} is null or ${t.periodTo} >= ${t.periodFrom}`,
    ),
    check(
      'contractor_invoice_void_reason_check',
      sql`${t.status} <> 'void' or length(trim(coalesce(${t.voidReason}, ''))) > 0`,
    ),
    currencyCheck('contractor_invoice_currency_check', t.currency),
    index('contractor_invoice_payee_idx').on(t.payeeId),
    ...rolePolicies('contractor_invoice', { read: 'finance', write: 'finance' }),
  ],
);

export type ContractorInvoice = typeof contractorInvoice.$inferSelect;
