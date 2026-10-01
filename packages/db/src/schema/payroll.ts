import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, rolePolicies } from './_common';
import { assignment, period, timesheet } from './engagements';
import {
  adjustmentKind,
  fundingSource,
  fxSource,
  payoutMethod,
  payrollItemStatus,
  payrollLineStatus,
} from './enums';
import { invoiceLine } from './invoices';
import { payee, person } from './parties';

/**
 * What one person gets for a period through one payout method (5.2): fiat items are paid in UAH
 * (`total_uah`), crypto items in USD-pegged coins (`total_usd`). `paid_amount` = Σ allocations.
 */
export const payrollItem = pgTable(
  'payroll_item',
  {
    ...baseColumns,
    legacyRef: text(),
    periodId: uuid()
      .notNull()
      .references(() => period.id),
    personId: uuid()
      .notNull()
      .references(() => person.id),
    payoutMethod: payoutMethod().notNull(),
    payeeId: uuid().references(() => payee.id),
    status: payrollItemStatus().notNull().default('draft'),
    totalUsd: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    payoutFxRate: numeric({ precision: 18, scale: 6 }),
    fxSource: fxSource(),
    fxSetBy: uuid(),
    fxSetAt: timestamp({ withTimezone: true }),
    totalUah: numeric({ precision: 20, scale: 2 }),
    paidAmount: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
  },
  (t) => [
    unique('payroll_item_legacy_ref_key').on(t.legacyRef),
    unique('payroll_item_key').on(t.periodId, t.personId, t.payoutMethod),
    check(
      'payroll_item_fx_check',
      sql`(${t.payoutFxRate} is null) = (${t.totalUah} is null) and (${t.payoutFxRate} is null) = (${t.fxSource} is null)`,
    ),
    index('payroll_item_period_idx').on(t.periodId),
    ...rolePolicies('payroll_item', { read: 'finance', write: 'finance' }),
  ],
);

/** One assignment's pay for the period; funded by the invoice line of the same timesheet (5.3). */
export const payrollLine = pgTable(
  'payroll_line',
  {
    ...baseColumns,
    payrollItemId: uuid()
      .notNull()
      .references(() => payrollItem.id, { onDelete: 'cascade' }),
    assignmentId: uuid()
      .notNull()
      .references(() => assignment.id),
    timesheetId: uuid().references(() => timesheet.id),
    amountUsd: numeric({ precision: 20, scale: 8 }).notNull(),
    fundedByInvoiceLineId: uuid().references(() => invoiceLine.id, { onDelete: 'set null' }),
    fundingSource: fundingSource(),
    status: payrollLineStatus().notNull().default('accrued'),
    payableAt: timestamp({ withTimezone: true }),
    overrideReason: text(),
  },
  (t) => [
    unique('payroll_line_timesheet_key').on(t.timesheetId),
    unique('payroll_line_assignment_key').on(t.payrollItemId, t.assignmentId),
    check(
      'payroll_line_payable_check',
      sql`${t.status} in ('accrued', 'awaiting_client') or ${t.fundingSource} is not null`,
    ),
    index('payroll_line_funded_by_idx').on(t.fundedByInvoiceLineId),
    ...rolePolicies('payroll_line', { read: 'finance', write: 'finance' }),
  ],
);

/**
 * Manual change of a payout with a reason (bonus, deduction, legacy correction). Entered in step 4
 * of the period wizard, before payroll items exist, so it is keyed like the item (A-050).
 */
export const adjustment = pgTable(
  'adjustment',
  {
    ...baseColumns,
    legacyRef: text(),
    periodId: uuid()
      .notNull()
      .references(() => period.id),
    personId: uuid()
      .notNull()
      .references(() => person.id),
    payoutMethod: payoutMethod().notNull().default('fiat'),
    kind: adjustmentKind().notNull(),
    amount: numeric({ precision: 20, scale: 8 }).notNull(),
    currency: text().notNull(),
    reason: text().notNull(),
  },
  (t) => [
    unique('adjustment_legacy_ref_key').on(t.legacyRef),
    check('adjustment_amount_check', sql`${t.amount} <> 0`),
    check('adjustment_reason_check', sql`length(trim(${t.reason})) > 0`),
    check('adjustment_currency_check', sql`${t.currency} in ('USD', 'USDT', 'USDC', 'UAH')`),
    currencyCheck('adjustment_currency_format_check', t.currency),
    index('adjustment_period_person_idx').on(t.periodId, t.personId),
    ...rolePolicies('adjustment', { read: 'finance', write: 'finance' }),
  ],
);

export type PayrollItem = typeof payrollItem.$inferSelect;
export type PayrollLine = typeof payrollLine.$inferSelect;
export type Adjustment = typeof adjustment.$inferSelect;
