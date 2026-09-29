import {
  billingLineAmount,
  payrollLineAmount,
  type BillingTermsInput,
  type PayTermsInput,
} from './billing';
import { isAssignmentActive } from './bench';
import { endOfMonth, type LocalDate } from './local-date';
import { Decimal, roundHalfUp, sum, toDecimal, type DecimalInput } from './money';
import { effectiveVersion } from './terms';

export type PeriodAssignment = {
  assignmentId: string;
  personName: string;
  clientName: string | null;
  contractId: string | null;
  roleTitle: string | null;
  isInternal: boolean;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  billing: (BillingTermsInput & { validFrom: LocalDate; currency: string })[];
  pay: (PayTermsInput & { validFrom: LocalDate; currency: string })[];
  hours: string | null;
};

export type PreviewRow = {
  assignmentId: string;
  personName: string;
  clientName: string | null;
  contractId: string | null;
  roleTitle: string | null;
  hours: string;
  billing: (BillingTermsInput & { currency: string }) | null;
  invoiceAmount: string | null;
  payUsd: string;
  payUahApprox: string | null;
};

export type PeriodPreview = {
  rows: PreviewRow[];
  totals: { invoiceUsd: string; payUsd: string; payUahApprox: string | null };
};

/** Assignments active at any time during the month take part in the period. */
export function isActiveInMonth(
  a: { startsOn: LocalDate; endsOn: LocalDate | null },
  month: LocalDate,
): boolean {
  return a.startsOn <= endOfMonth(month) && (a.endsOn === null || a.endsOn >= month);
}

/**
 * Preview of a month in the legacy `Current` layout (spec 6.4 step 3). Totals are always the sum
 * of every row — the legacy sheet's SUM range missed the last rows (A1).
 */
export function periodPreview(
  month: LocalDate,
  workHours: DecimalInput,
  referenceFx: DecimalInput | null,
  assignments: readonly PeriodAssignment[],
): PeriodPreview {
  const rows: PreviewRow[] = assignments
    .filter((a) => isActiveInMonth(a, month))
    .map((a) => {
      const hours = a.hours ?? '0';
      const b = effectiveVersion(a.billing, month);
      const p = effectiveVersion(a.pay, month);
      const invoice = b ? billingLineAmount(b, hours, workHours) : null;
      const pay = p ? payrollLineAmount(p, hours, workHours) : new Decimal(0);
      return {
        assignmentId: a.assignmentId,
        personName: a.personName,
        clientName: a.clientName,
        contractId: a.contractId,
        roleTitle: a.roleTitle,
        hours: toDecimal(hours).toFixed(2),
        billing: b
          ? { type: b.type, rate: b.rate, prorationPolicy: b.prorationPolicy, currency: b.currency }
          : null,
        invoiceAmount: invoice ? invoice.toFixed(2) : null,
        payUsd: pay.toFixed(2),
        payUahApprox:
          referenceFx === null ? null : roundHalfUp(pay.times(toDecimal(referenceFx))).toFixed(2),
      };
    });
  return {
    rows,
    totals: {
      invoiceUsd: sum(rows.map((r) => r.invoiceAmount ?? '0')).toFixed(2),
      payUsd: sum(rows.map((r) => r.payUsd)).toFixed(2),
      payUahApprox:
        referenceFx === null ? null : sum(rows.map((r) => r.payUahApprox ?? '0')).toFixed(2),
    },
  };
}

export type DraftLine = {
  assignmentId: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

/**
 * Invoice line numbers (spec 5.1): quantity = hours and unit price = effective hourly rate; for
 * `full_month` the monthly fee with quantity 1. Amount is the rounded line total from 5.1.
 */
export function draftLine(
  assignmentId: string,
  billing: BillingTermsInput,
  hours: DecimalInput,
  workHours: DecimalInput,
): DraftLine | null {
  const amount = billingLineAmount(billing, hours, workHours);
  if (!amount) return null;
  const r = toDecimal(billing.rate);
  const H = toDecimal(workHours);
  if (billing.type === 'fixed_monthly' && billing.prorationPolicy === 'full_month') {
    return { assignmentId, quantity: '1.00', unitPrice: r.toFixed(8), amount: amount.toFixed(2) };
  }
  const unit =
    billing.type === 'hourly'
      ? r
      : billing.prorationPolicy === 'trunc_hourly'
        ? r.div(H).floor()
        : r.div(H);
  return {
    assignmentId,
    quantity: toDecimal(hours).toFixed(2),
    unitPrice: unit.toDecimalPlaces(8).toFixed(8),
    amount: amount.toFixed(2),
  };
}

export { isAssignmentActive };
