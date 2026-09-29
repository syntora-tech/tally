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
