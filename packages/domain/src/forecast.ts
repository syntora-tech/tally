import {
  billingLineAmount,
  payrollLineAmount,
  type BillingTermsInput,
  type PayTermsInput,
} from './billing';
import type { LocalDate } from './local-date';
import { Decimal, toDecimal, type DecimalInput } from './money';
import { isActiveInMonth } from './period';
import { plannedExpenseDates, type PlannedExpenseTerms } from './planned-expense';
import { effectiveVersion } from './terms';
import type { ToUsd } from './usd';

export type ForecastAssignment = {
  assignmentId: string;
  fte: DecimalInput;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  billing: (BillingTermsInput & { validFrom: LocalDate; currency: string })[];
  pay: (PayTermsInput & { validFrom: LocalDate; currency: string })[];
  agency: { validFrom: LocalDate; ratePerHour: DecimalInput }[];
};

export type ForecastExpense = PlannedExpenseTerms & { amount: DecimalInput; currency: string };

export type ForecastMonth = {
  month: LocalDate;
  revenueUsd: string;
  payrollUsd: string;
  agencyUsd: string;
  plannedUsd: string;
  netUsd: string;
  /** Currencies left out for lack of a rate. */
  unconverted: string[];
};

/**
 * Six-month forecast (6.1, A-069) by accrual: every active assignment works H × FTE hours under
 * its terms for that month, agency fees per hour, plus planned expenses due in the month.
 */
export function forecastMonths(
  months: readonly { month: LocalDate; workHours: DecimalInput }[],
  assignments: readonly ForecastAssignment[],
  expenses: readonly ForecastExpense[],
  toUsd: ToUsd,
): ForecastMonth[] {
  return months.map(({ month, workHours }) => {
    const H = toDecimal(workHours);
    const unconverted = new Set<string>();
    const usd = (amount: Decimal | null, currency: string) => {
      if (!amount || amount.isZero()) return new Decimal(0);
      const value = toUsd(amount, currency);
      if (value === null) unconverted.add(currency);
      return value ?? new Decimal(0);
    };
    let revenue = new Decimal(0);
    let payroll = new Decimal(0);
    let agency = new Decimal(0);
    for (const a of assignments) {
      if (!isActiveInMonth(a, month)) continue;
      const hours = H.times(toDecimal(a.fte));
      const b = effectiveVersion(a.billing, month);
      if (b) revenue = revenue.plus(usd(billingLineAmount(b, hours, H), b.currency));
      const p = effectiveVersion(a.pay, month);
      if (p) payroll = payroll.plus(usd(payrollLineAmount(p, hours, H), p.currency));
      const fee = effectiveVersion(a.agency, month);
      if (fee) agency = agency.plus(toDecimal(fee.ratePerHour).times(hours));
    }
    let planned = new Decimal(0);
    for (const e of expenses) {
      const times = plannedExpenseDates(e, month, 1).length;
      if (times > 0) planned = planned.plus(usd(toDecimal(e.amount).times(times), e.currency));
    }
    return {
      month,
      revenueUsd: revenue.toFixed(2),
      payrollUsd: payroll.toFixed(2),
      agencyUsd: agency.toFixed(2),
      plannedUsd: planned.toFixed(2),
      netUsd: revenue.minus(payroll).minus(agency).minus(planned).toFixed(2),
      unconverted: [...unconverted].sort(),
    };
  });
}
