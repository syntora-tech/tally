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
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns, currencyCheck, rolePolicies } from './_common';
import {
  billingType,
  payoutMethod,
  payType,
  periodStatus,
  prorationPolicy,
  releasePolicy,
} from './enums';
import { numberSequence } from './numbering';
import { client, company, payee, person } from './parties';

const firstOfMonth = (column: string) => sql.raw(`extract(day from ${column}) = 1`);

/** Client MSA/contract or FOP contract; exactly one counterparty (I9). */
export const contract = pgTable(
  'contract',
  {
    ...baseColumns,
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
    kind: text().notNull(),
    number: text().notNull(),
    signedOn: date({ mode: 'string' }),
    companyId: uuid()
      .notNull()
      .references(() => company.id),
    clientId: uuid().references(() => client.id),
    payeeId: uuid().references(() => payee.id),
    currency: text().notNull().default('USD'),
    paymentDueRule: jsonb()
      .notNull()
      .default(sql`'{"type":"day_of_month","day":20}'::jsonb`),
    invoiceDateRule: jsonb()
      .notNull()
      .default(sql`'{"type":"first_working_day_after_period"}'::jsonb`),
    actDateRule: jsonb()
      .notNull()
      .default(sql`'{"type":"last_working_day_of_period"}'::jsonb`),
    invoiceTemplateFileId: text(),
    actTemplateFileId: text(),
    numberSequenceKey: text().references(() => numberSequence.key),
    status: text().notNull().default('active'),
  },
  (t) => [
    unique('contract_legacy_ref_key').on(t.legacyRef),
    check('contract_kind_check', sql`${t.kind} in ('client', 'fop')`),
    check(
      'contract_one_counterparty_check',
      sql`num_nonnulls(${t.clientId}, ${t.payeeId}) = 1 and (${t.kind} = 'client') = (${t.clientId} is not null)`,
    ),
    check('contract_status_check', sql`${t.status} in ('active', 'ended')`),
    check(
      'contract_payment_due_rule_check',
      sql`${t.paymentDueRule} ->> 'type' in ('day_of_month', 'net_days')`,
    ),
    check(
      'contract_invoice_date_rule_check',
      sql`${t.invoiceDateRule} ->> 'type' in ('first_working_day_after_period', 'nth_working_day_after_period')`,
    ),
    check(
      'contract_act_date_rule_check',
      sql`${t.actDateRule} ->> 'type' in ('last_working_day_of_period', 'nth_working_day_after_period', 'manual')`,
    ),
    currencyCheck('contract_currency_check', t.currency),
    index('contract_client_idx').on(t.clientId),
    index('contract_payee_idx').on(t.payeeId),
    ...rolePolicies('contract', { read: 'finance', write: 'finance' }),
  ],
);

/** A person on a contract/SOW (one row of the legacy `Current` sheet). */
export const assignment = pgTable(
  'assignment',
  {
    ...baseColumns,
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
    personId: uuid()
      .notNull()
      .references(() => person.id),
    contractId: uuid().references(() => contract.id),
    isInternal: boolean().notNull().default(false),
    sowRef: text(),
    roleTitle: text(),
    fte: numeric({ precision: 4, scale: 2 }).notNull().default('1'),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }),
  },
  (t) => [
    unique('assignment_legacy_ref_key').on(t.legacyRef),
    check('assignment_contract_check', sql`${t.isInternal} or ${t.contractId} is not null`),
    check('assignment_fte_check', sql`${t.fte} > 0 and ${t.fte} <= 1`),
    check('assignment_dates_check', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    index('assignment_person_idx').on(t.personId),
    index('assignment_contract_idx').on(t.contractId),
    ...rolePolicies('assignment', { read: 'finance', write: 'finance' }),
  ],
);

/** What we charge the client; a new version is a new row (spec 6.3). */
export const billingTerms = pgTable(
  'billing_terms',
  {
    ...baseColumns,
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
    assignmentId: uuid()
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    validFrom: date({ mode: 'string' }).notNull(),
    type: billingType().notNull(),
    rate: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    currency: text().notNull().default('USD'),
    prorationPolicy: prorationPolicy().notNull().default('full_month'),
    invoiceChannel: payoutMethod().notNull().default('fiat'),
  },
  (t) => [
    unique('billing_terms_legacy_ref_key').on(t.legacyRef),
    unique('billing_terms_version_key').on(t.assignmentId, t.validFrom),
    check('billing_terms_valid_from_check', firstOfMonth('valid_from')),
    check('billing_terms_rate_check', sql`${t.rate} >= 0`),
    currencyCheck('billing_terms_currency_check', t.currency),
    ...rolePolicies('billing_terms', { read: 'finance', write: 'finance' }),
  ],
);

/** What we pay the person; `fixed` amounts already include FTE (spec 5.2). */
export const payTerms = pgTable(
  'pay_terms',
  {
    ...baseColumns,
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
    assignmentId: uuid()
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    validFrom: date({ mode: 'string' }).notNull(),
    type: payType().notNull(),
    amount: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    currency: text().notNull().default('USD'),
    payoutMethod: payoutMethod().notNull().default('fiat'),
    releasePolicy: releasePolicy().notNull().default('on_payment_or_due'),
    graceDays: integer().notNull().default(0),
  },
  (t) => [
    unique('pay_terms_legacy_ref_key').on(t.legacyRef),
    unique('pay_terms_version_key').on(t.assignmentId, t.validFrom),
    check('pay_terms_valid_from_check', firstOfMonth('valid_from')),
    check('pay_terms_amount_check', sql`${t.amount} >= 0`),
    check('pay_terms_grace_days_check', sql`${t.graceDays} >= 0`),
    currencyCheck('pay_terms_currency_check', t.currency),
    ...rolePolicies('pay_terms', { read: 'finance', write: 'finance' }),
  ],
);

/**
 * What an agency gets for placing a person (A-068): a USD rate per hour the person works, paid to
 * the agency's payee as its own payout. Versioned like pay terms; rate 0 ends the fee.
 */
export const agencyTerms = pgTable(
  'agency_terms',
  {
    ...baseColumns,
    assignmentId: uuid()
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    validFrom: date({ mode: 'string' }).notNull(),
    payeeId: uuid()
      .notNull()
      .references(() => payee.id),
    ratePerHour: numeric({ precision: 20, scale: 8 }).notNull().default('0'),
    currency: text().notNull().default('USD'),
    payoutMethod: payoutMethod().notNull().default('fiat'),
    releasePolicy: releasePolicy().notNull().default('on_payment_or_due'),
    graceDays: integer().notNull().default(0),
  },
  (t) => [
    unique('agency_terms_version_key').on(t.assignmentId, t.validFrom),
    check('agency_terms_valid_from_check', firstOfMonth('valid_from')),
    check('agency_terms_rate_check', sql`${t.ratePerHour} >= 0`),
    check('agency_terms_grace_days_check', sql`${t.graceDays} >= 0`),
    // Payroll lines are accrued in USD (5.2).
    check('agency_terms_currency_check', sql`${t.currency} = 'USD'`),
    index('agency_terms_payee_idx').on(t.payeeId),
    ...rolePolicies('agency_terms', { read: 'finance', write: 'finance' }),
  ],
);

/** Month; the close wizard arrives in stage 2, the table is here for I10 (assumptions). */
export const period = pgTable(
  'period',
  {
    ...baseColumns,
    month: date({ mode: 'string' }).notNull().unique(),
    workHours: numeric({ precision: 6, scale: 2 }).notNull(),
    status: periodStatus().notNull().default('open'),
    referenceFxUsdUah: numeric({ precision: 18, scale: 6 }),
    closedAt: timestamp({ withTimezone: true }),
    closedBy: uuid(),
  },
  (t) => [
    check('period_month_check', firstOfMonth('month')),
    check('period_work_hours_check', sql`${t.workHours} > 0`),
    ...rolePolicies('period', { read: 'finance', write: 'finance' }),
  ],
);

/** Hours per assignment × period (spec 4.2); editing and I6 arrive with the period wizard. */
export const timesheet = pgTable(
  'timesheet',
  {
    ...baseColumns,
    legacyRef: text(),
    assignmentId: uuid()
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    periodId: uuid()
      .notNull()
      .references(() => period.id),
    hours: numeric({ precision: 6, scale: 2 }).notNull(),
    source: text().notNull().default('manual'),
    /** Which project of the assignment these hours were for, e.g. several projects under one SOW. */
    note: text(),
  },
  (t) => [
    unique('timesheet_legacy_ref_key').on(t.legacyRef),
    unique('timesheet_assignment_period_key').on(t.assignmentId, t.periodId),
    check('timesheet_hours_check', sql`${t.hours} >= 0`),
    check('timesheet_source_check', sql`${t.source} in ('manual', 'import')`),
    ...rolePolicies('timesheet', { read: 'finance', write: 'finance' }),
  ],
);

export type Contract = typeof contract.$inferSelect;
export type Timesheet = typeof timesheet.$inferSelect;
export type Assignment = typeof assignment.$inferSelect;
export type BillingTerms = typeof billingTerms.$inferSelect;
export type PayTerms = typeof payTerms.$inferSelect;
export type Period = typeof period.$inferSelect;
