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
import {
  payrollTotalUah,
  payrollTotalUsd,
  type AdjustmentInput,
  type PayoutMethod,
  type ReleasePolicy,
} from './payroll';

export type PeriodPayTerms = PayTermsInput & {
  validFrom: LocalDate;
  currency: string;
  payoutMethod?: PayoutMethod;
  releasePolicy?: ReleasePolicy;
  graceDays?: number;
};

export type PeriodAssignment = {
  assignmentId: string;
  /** Groups payroll items (5.2); defaults to the name in tests that do not need it. */
  personId?: string;
  personName: string;
  clientName: string | null;
  contractId: string | null;
  roleTitle: string | null;
  isInternal: boolean;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  billing: (BillingTermsInput & { validFrom: LocalDate; currency: string })[];
  pay: PeriodPayTerms[];
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

export type PlanAdjustment = AdjustmentInput & { personId: string; payoutMethod: PayoutMethod };

export type PlanLine = {
  assignmentId: string;
  amountUsd: string;
  releasePolicy: ReleasePolicy;
  graceDays: number;
};

export type PlanItem = {
  personId: string;
  personName: string;
  payoutMethod: PayoutMethod;
  lines: PlanLine[];
  adjustments: AdjustmentInput[];
  totalUsd: string;
  /** At the reference rate; the real rate is set at payout (5.4). */
  totalUahApprox: string | null;
};

/**
 * Payroll for a month (5.2): one line per active assignment with pay terms (`included` gives a zero
 * line for transparency), grouped into items per person × payout method; adjustments without
 * lines still form an item.
 */
export function payrollPlan(
  month: LocalDate,
  workHours: DecimalInput,
  referenceFx: DecimalInput | null,
  assignments: readonly PeriodAssignment[],
  adjustments: readonly PlanAdjustment[],
): PlanItem[] {
  const items = new Map<string, PlanItem>();
  const itemFor = (personId: string, personName: string, method: PayoutMethod) => {
    const key = `${personId}:${method}`;
    let item = items.get(key);
    if (!item) {
      item = {
        personId,
        personName,
        payoutMethod: method,
        lines: [],
        adjustments: [],
        totalUsd: '0',
        totalUahApprox: null,
      };
      items.set(key, item);
    }
    return item;
  };
  for (const a of assignments) {
    if (!isActiveInMonth(a, month)) continue;
    const terms = effectiveVersion(a.pay, month);
    if (!terms) continue;
    itemFor(a.personId ?? a.personName, a.personName, terms.payoutMethod ?? 'fiat').lines.push({
      assignmentId: a.assignmentId,
      amountUsd: payrollLineAmount(terms, a.hours ?? '0', workHours).toFixed(2),
      releasePolicy: terms.releasePolicy ?? 'on_payment_or_due',
      graceDays: terms.graceDays ?? 0,
    });
  }
  const names = new Map(assignments.map((a) => [a.personId ?? a.personName, a.personName]));
  for (const adj of adjustments) {
    itemFor(adj.personId, names.get(adj.personId) ?? '', adj.payoutMethod).adjustments.push({
      amount: adj.amount,
      currency: adj.currency,
    });
  }
  return [...items.values()].map((item) => {
    const lines = item.lines.map((l) => l.amountUsd);
    const uah = referenceFx === null ? null : payrollTotalUah(lines, item.adjustments, referenceFx);
    return {
      ...item,
      totalUsd: payrollTotalUsd(lines, item.adjustments).toFixed(2),
      totalUahApprox: uah?.isOk() ? uah.value.toFixed(2) : null,
    };
  });
}
