import { pgEnum } from 'drizzle-orm/pg-core';

export const appRole = pgEnum('app_role', ['owner', 'finance', 'viewer']);
export type AppRole = (typeof appRole.enumValues)[number];

export const billingType = pgEnum('billing_type', ['fixed_monthly', 'hourly', 'none']);
export const prorationPolicy = pgEnum('proration_policy', [
  'full_month',
  'by_hours',
  'trunc_hourly',
]);
export const payType = pgEnum('pay_type', ['fixed', 'hourly', 'included']);
export const releasePolicy = pgEnum('release_policy', ['immediate', 'on_payment_or_due']);
export const payoutMethod = pgEnum('payout_method', ['fiat', 'crypto']);
export const periodStatus = pgEnum('period_status', ['open', 'closed']);
export const docStatus = pgEnum('doc_status', ['draft', 'issued', 'void']);
export const invoiceStatus = pgEnum('invoice_status', [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'void',
  'written_off',
]);
export type InvoiceStatus = (typeof invoiceStatus.enumValues)[number];
export const txType = pgEnum('tx_type', [
  'revenue',
  'expense',
  'transfer',
  'fx_exchange',
  'crypto_buy',
  'crypto_sell',
  'crypto_swap',
  'adjustment',
]);
export type TxType = (typeof txType.enumValues)[number];
export const plannedFrequency = pgEnum('planned_frequency', ['monthly', 'quarterly', 'yearly']);
export const accountKind = pgEnum('account_kind', ['bank', 'crypto', 'cash']);
export const fxSource = pgEnum('fx_source', ['bank_actual', 'nbu', 'manual']);
export const payrollItemStatus = pgEnum('payroll_item_status', [
  'draft',
  'partially_payable',
  'payable',
  'partially_paid',
  'paid',
]);
export const payrollLineStatus = pgEnum('payroll_line_status', [
  'accrued',
  'awaiting_client',
  'payable',
  'paid',
]);
export const fundingSource = pgEnum('funding_source', ['client', 'company']);
export const adjustmentKind = pgEnum('adjustment_kind', [
  'bonus',
  'deduction',
  'trip_reimbursement',
  'correction',
  'other',
]);
export const actType = pgEnum('act_type', ['monthly', 'reimbursement', 'other']);
