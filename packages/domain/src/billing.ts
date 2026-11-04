import { Decimal, roundHalfUp, toDecimal, type DecimalInput } from './money';

export type BillingType = 'fixed_monthly' | 'hourly' | 'none';
export type ProrationPolicy = 'full_month' | 'by_hours' | 'trunc_hourly';
export type PayType = 'fixed' | 'hourly' | 'hourly_rate' | 'included';

export type BillingTermsInput = {
  type: BillingType;
  rate: DecimalInput;
  prorationPolicy: ProrationPolicy;
};

export type PayTermsInput = {
  type: PayType;
  amount: DecimalInput;
};

/**
 * Invoice line amount (spec 5.1). `null` means no line: zero hours or billing type `none`.
 * h — hours in the period, H — period norm hours.
 */
export function billingLineAmount(
  terms: BillingTermsInput,
  hours: DecimalInput,
  workHours: DecimalInput,
): Decimal | null {
  const h = toDecimal(hours);
  const H = toDecimal(workHours);
  const r = toDecimal(terms.rate);
  if (terms.type === 'none' || h.isZero()) return null;
  if (terms.type === 'hourly') return roundHalfUp(r.times(h));
  switch (terms.prorationPolicy) {
    case 'full_month':
      return roundHalfUp(r);
    case 'by_hours':
      return roundHalfUp(r.div(H).times(h));
    case 'trunc_hourly':
      return roundHalfUp(r.div(H).floor().times(h));
  }
}

/**
 * Payroll line amount in the terms currency (spec 5.2). `fixed` already includes FTE; `hourly`
 * spreads a monthly amount over the norm, `hourly_rate` pays the amount per hour (A-074).
 */
export function payrollLineAmount(
  terms: PayTermsInput,
  hours: DecimalInput,
  workHours: DecimalInput,
): Decimal {
  switch (terms.type) {
    case 'fixed':
      return roundHalfUp(terms.amount);
    case 'hourly':
      return roundHalfUp(toDecimal(terms.amount).div(toDecimal(workHours)).times(toDecimal(hours)));
    case 'hourly_rate':
      return roundHalfUp(toDecimal(terms.amount).times(toDecimal(hours)));
    case 'included':
      return new Decimal(0);
  }
}

export type TermsMargin = {
  billing: Decimal;
  pay: Decimal;
  /** Agency fee for the month (A-068), USD per hour × H. */
  agency: Decimal;
  margin: Decimal;
};

/**
 * "Margin by terms" (assumptions A-015): billing and pay for a full month, h = H.
 * Returns null when currencies differ, because no FX rate is implied here.
 */
export function marginByTerms(
  billing: (BillingTermsInput & { currency: string }) | null,
  pay: (PayTermsInput & { currency: string }) | null,
  workHours: DecimalInput,
  agencyRatePerHour: DecimalInput = '0',
): TermsMargin | null {
  if (billing && pay && billing.currency !== pay.currency) return null;
  const agency = toDecimal(agencyRatePerHour).times(toDecimal(workHours));
  // Agency fees are in USD; without a rate there is no margin in another currency.
  if (!agency.isZero() && (billing?.currency ?? pay?.currency ?? 'USD') !== 'USD') return null;
  const billed = (billing && billingLineAmount(billing, workHours, workHours)) ?? new Decimal(0);
  const paid = pay ? payrollLineAmount(pay, workHours, workHours) : new Decimal(0);
  return { billing: billed, pay: paid, agency, margin: billed.minus(paid).minus(agency) };
}
