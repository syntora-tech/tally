import { toDecimal } from '@tally/domain';
import { z } from 'zod';
import {
  checkbox,
  currencyCode,
  localDateString,
  monthStart,
  nonNegativeDecimal,
  optionalLocalDate,
  optionalText,
} from '../fields';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const BILLING_TYPES = ['fixed_monthly', 'hourly', 'none'] as const;
export const PRORATION_POLICIES = ['full_month', 'by_hours', 'trunc_hourly'] as const;
export const PAY_TYPES = ['fixed', 'hourly', 'included'] as const;
export const PAYOUT_METHODS = ['fiat', 'crypto'] as const;
export const RELEASE_POLICIES = ['immediate', 'on_payment_or_due'] as const;

/** A number or blank; blank means zero for types that carry no amount (`none`, `included`). */
const amountOrZero = z.preprocess((v) => emptyToNull(v) ?? '0', nonNegativeDecimal);

/** «Клієнту» block: what we charge (spec 4.2 billing_terms, 5.1). */
export const billingTermsFields = z.object({
  type: z.enum(BILLING_TYPES),
  rate: amountOrZero,
  currency: currencyCode.default('USD'),
  prorationPolicy: z.enum(PRORATION_POLICIES).default('full_month'),
  invoiceChannel: z.enum(PAYOUT_METHODS).default('fiat'),
});

/** «Людині» block: what we pay (spec 4.2 pay_terms, 5.2). `fixed` already includes FTE. */
export const payTermsFields = z.object({
  type: z.enum(PAY_TYPES),
  amount: amountOrZero,
  currency: currencyCode.default('USD'),
  payoutMethod: z.enum(PAYOUT_METHODS).default('fiat'),
  releasePolicy: z.enum(RELEASE_POLICIES).default('on_payment_or_due'),
  graceDays: z.coerce.number().int().min(0).max(60).default(0),
});

export const assignmentCoreShape = {
  sowRef: optionalText,
  roleTitle: optionalText,
  fte: z
    .preprocess((v) => emptyToNull(v) ?? '1', nonNegativeDecimal)
    .refine((v) => {
      const fte = toDecimal(v);
      return fte.gt(0) && fte.lte(1) && fte.decimalPlaces() <= 2;
    }, 'assignments.fte'),
  startsOn: localDateString,
  endsOn: optionalLocalDate,
};

/** SOW/annex of the assignment's contract (A-072); empty = the contract itself. */
const annexId = z
  .preprocess(emptyToNull, z.uuid().nullable().optional())
  .transform((v) => v ?? null);

export const createAssignmentInput = z
  .object({
    personId: z.uuid(),
    isInternal: checkbox,
    contractId: z
      .preprocess(emptyToNull, z.uuid().nullable().optional())
      .transform((v) => v ?? null),
    annexId,
    ...assignmentCoreShape,
    billing: billingTermsFields,
    pay: payTermsFields,
  })
  .refine((a) => a.isInternal || a.contractId, {
    message: 'assignments.contractOrInternal',
    path: ['contractId'],
  })
  .refine((a) => !a.endsOn || a.endsOn >= a.startsOn, {
    message: 'assignments.endBeforeStart',
    path: ['endsOn'],
  });

export const updateAssignmentInput = z
  .object({ id: z.uuid(), annexId, ...assignmentCoreShape })
  .refine((a) => !a.endsOn || a.endsOn >= a.startsOn, {
    message: 'assignments.endBeforeStart',
    path: ['endsOn'],
  });

export const addBillingVersionInput = billingTermsFields.extend({
  assignmentId: z.uuid(),
  validFrom: monthStart,
});

export const addPayVersionInput = payTermsFields.extend({
  assignmentId: z.uuid(),
  validFrom: monthStart,
});

/** Agency fee (A-068): USD per hour the person works, paid to the agency payee. Rate 0 ends it. */
export const addAgencyVersionInput = z.object({
  assignmentId: z.uuid(),
  validFrom: monthStart,
  payeeId: z.uuid({ error: 'assignments.chooseAgency' }),
  ratePerHour: amountOrZero,
  payoutMethod: z.enum(PAYOUT_METHODS).default('fiat'),
  releasePolicy: z.enum(RELEASE_POLICIES).default('on_payment_or_due'),
  graceDays: z.coerce.number().int().min(0).max(60).default(0),
});
