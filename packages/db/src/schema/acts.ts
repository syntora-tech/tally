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
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns, rolePolicies } from './_common';
import { contract } from './engagements';
import { actType, docStatus } from './enums';
import { payee } from './parties';
import { payrollItem } from './payroll';
import { reimbursement } from './trips';

/**
 * Act of a FOP contractor (spec 4.2, 6.6). The monthly act equals `total_uah` of its payroll item;
 * once issued it is immutable (I1), dated on a working day (I3), numbered from the contract's
 * sequence (I2). Signed copies live in Vchasno (`signed_url`).
 */
export const supplierAct = pgTable(
  'supplier_act',
  {
    ...baseColumns,
    legacyRef: text(),
    /** Historic acts from the registry: exempt from I3 and the snapshot requirement (spec 8, A8). */
    isLegacy: boolean().notNull().default(false),
    contractId: uuid()
      .notNull()
      .references(() => contract.id),
    payeeId: uuid()
      .notNull()
      .references(() => payee.id),
    payrollItemId: uuid().references(() => payrollItem.id),
    /** An extra act for a trip reimbursement (6.6, A-070). */
    reimbursementId: uuid().references((): AnyPgColumn => reimbursement.id),
    type: actType().notNull().default('monthly'),
    number: text(),
    actDate: date({ mode: 'string' }).notNull(),
    periodFrom: date({ mode: 'string' }),
    periodTo: date({ mode: 'string' }),
    amountUah: numeric({ precision: 20, scale: 2 }).notNull(),
    status: docStatus().notNull().default('draft'),
    snapshot: jsonb(),
    gdocFileId: text(),
    pdfFileId: text(),
    signedUrl: text(),
    dateOverrideReason: text(),
    voidReason: text(),
  },
  (t) => [
    unique('supplier_act_legacy_ref_key').on(t.legacyRef),
    uniqueIndex('supplier_act_number_key')
      .on(t.contractId, t.number)
      .where(sql`${t.status} <> 'draft'`),
    check('supplier_act_draft_number_check', sql`${t.status} <> 'draft' or ${t.number} is null`),
    check(
      'supplier_act_issued_number_check',
      sql`${t.status} = 'draft' or ${t.number} is not null`,
    ),
    check('supplier_act_amount_check', sql`${t.amountUah} >= 0`),
    check(
      'supplier_act_period_check',
      sql`${t.periodFrom} is null or ${t.periodTo} is null or ${t.periodTo} >= ${t.periodFrom}`,
    ),
    check(
      'supplier_act_void_reason_check',
      sql`${t.status} <> 'void' or length(trim(coalesce(${t.voidReason}, ''))) > 0`,
    ),
    index('supplier_act_payee_idx').on(t.payeeId),
    index('supplier_act_payroll_item_idx').on(t.payrollItemId),
    ...rolePolicies('supplier_act', { read: 'finance', write: 'finance' }),
  ],
);

export type SupplierAct = typeof supplierAct.$inferSelect;
