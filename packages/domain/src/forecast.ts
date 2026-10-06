import {
  billingLineAmount,
  payrollLineAmount,
  type BillingTermsInput,
  type PayTermsInput,
} from './billing';
import type { LocalDate } from './local-date';
import { Decimal, toDecimal, type DecimalInput } from './money';
import { isActiveInMonth } from './period';
import {
  activeInMonth,
  chargeOn,
  convertVia,
  plannedMonthPayments,
  transferFee,
  type Money,
  type PlannedCharge,
  type PlannedExpenseRule,
  type PlannedPart,
  type TransferFee,
} from './planned-expense';
import { effectiveVersion } from './terms';
import type { ToUsd } from './usd';

export type ForecastAssignment = {
  assignmentId: string;
  personId?: string;
  fte: DecimalInput;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  billing: (BillingTermsInput & { validFrom: LocalDate; currency: string })[];
  pay: (PayTermsInput & { validFrom: LocalDate; currency: string })[];
  agency: { validFrom: LocalDate; ratePerHour: DecimalInput }[];
};

export type ForecastExpense = PlannedExpenseRule & {
  parts?: readonly PlannedPart[];
  charges?: readonly PlannedCharge[];
};

/** Taxes on every payout of a person and the payee's transfer fee (A-082). */
export type ForecastPersonCosts = {
  personId: string;
  charges: readonly PlannedCharge[];
  fee: TransferFee | null;
};

export type ForecastMonth = {
  month: LocalDate;
  revenueUsd: string;
  payrollUsd: string;
  agencyUsd: string;
  plannedUsd: string;
  /** Taxes on payouts and their transfer fees (A-082). */
  chargesUsd: string;
  netUsd: string;
  /** Currencies left out for lack of a rate. */
  unconverted: string[];
};

/**
 * Six-month forecast (6.1, A-069) by accrual: every active assignment works H × FTE hours under
 * its terms for that month, agency fees per hour, plus planned expenses due in the month with their
 * charges and fees, and taxes and transfer fees on each person's payout (A-082).
 */
export function forecastMonths(
  months: readonly { month: LocalDate; workHours: DecimalInput }[],
  assignments: readonly ForecastAssignment[],
  expenses: readonly ForecastExpense[],
  toUsd: ToUsd,
  people: readonly ForecastPersonCosts[] = [],
): ForecastMonth[] {
  const convert = convertVia(toUsd);
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
    const payByPerson = new Map<string, Decimal>();
    for (const a of assignments) {
      if (!isActiveInMonth(a, month)) continue;
      const hours = H.times(toDecimal(a.fte));
      const b = effectiveVersion(a.billing, month);
      if (b) revenue = revenue.plus(usd(billingLineAmount(b, hours, H), b.currency));
      const p = effectiveVersion(a.pay, month);
      if (p) {
        const pay = usd(payrollLineAmount(p, hours, H), p.currency);
        payroll = payroll.plus(pay);
        if (a.personId) {
          payByPerson.set(a.personId, (payByPerson.get(a.personId) ?? new Decimal(0)).plus(pay));
        }
      }
      const fee = effectiveVersion(a.agency, month);
      if (fee) agency = agency.plus(toDecimal(fee.ratePerHour).times(hours));
    }
    const money = (m: Money | null) => (m ? usd(m.amount, m.currency) : new Decimal(0));
    let planned = new Decimal(0);
    for (const e of expenses) {
      for (const i of plannedMonthPayments(e, e.parts ?? [], e.charges ?? [], month, convert)) {
        planned = planned.plus(usd(i.net, i.currency)).plus(money(i.fee));
        for (const c of i.charges)
          planned = planned.plus(usd(c.amount, c.currency)).plus(money(c.fee));
      }
    }
    let charges = new Decimal(0);
    for (const person of people) {
      const pay = payByPerson.get(person.personId);
      if (!pay || pay.isZero()) continue;
      if (person.fee) charges = charges.plus(money(transferFee(person.fee, pay, 'USD', convert)));
      for (const c of person.charges.filter((x) => activeInMonth(x, month))) {
        const tax = chargeOn(c, pay, 'USD', convert);
        if (!tax) unconverted.add(c.currency ?? 'USD');
        charges = charges
          .plus(money(tax))
          .plus(money(tax && transferFee(c, tax.amount, tax.currency, convert)));
      }
    }
    return {
      month,
      revenueUsd: revenue.toFixed(2),
      payrollUsd: payroll.toFixed(2),
      agencyUsd: agency.toFixed(2),
      plannedUsd: planned.toFixed(2),
      chargesUsd: charges.toFixed(2),
      netUsd: revenue.minus(payroll).minus(agency).minus(planned).minus(charges).toFixed(2),
      unconverted: [...unconverted].sort(),
    };
  });
}
