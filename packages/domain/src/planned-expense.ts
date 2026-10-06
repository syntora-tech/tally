import {
  addMonths,
  daysInMonth,
  localDate,
  startOfMonth,
  toParts,
  type LocalDate,
} from './local-date';
import { Decimal, roundHalfUp, toDecimal, type DecimalInput } from './money';
import type { ToUsd } from './usd';

export type PlannedFrequency = 'monthly' | 'quarterly' | 'yearly';

export type PlannedExpenseTerms = {
  frequency: PlannedFrequency;
  /** First month of the cycle (1–12) for quarterly and yearly expenses. */
  anchorMonth: number | null;
  /** Day of the month the money goes out; past the month's end it falls on its last day. */
  dueDay: number | null;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
};

function dueInMonth(e: PlannedExpenseTerms, month: number): boolean {
  if (e.frequency === 'monthly') return true;
  const anchor = e.anchorMonth ?? 1;
  const step = e.frequency === 'quarterly' ? 3 : 12;
  return (((month - anchor) % step) + step) % step === 0;
}

/**
 * Dates a planned expense falls on in `count` months starting with the month of `from`
 * (A-067). The start and end are month-inclusive.
 */
export function plannedExpenseDates(
  e: PlannedExpenseTerms,
  from: LocalDate,
  count: number,
): LocalDate[] {
  const first = startOfMonth(e.startsOn);
  const last = e.endsOn ? startOfMonth(e.endsOn) : null;
  const dates: LocalDate[] = [];
  for (let i = 0; i < count; i++) {
    const month = addMonths(startOfMonth(from), i);
    if (month < first || (last !== null && month > last)) continue;
    const { year, month: m } = toParts(month);
    if (!dueInMonth(e, m)) continue;
    dates.push(localDate(year, m, Math.min(e.dueDay ?? 1, daysInMonth(year, m))));
  }
  return dates;
}

/** Converts an amount between currencies; null when a rate is missing. */
export type Convert = (amount: Decimal, from: string, to: string) => Decimal | null;

/** A converter through USD from `usdConverter` (spec 5.4 rates). */
export function convertVia(toUsd: ToUsd): Convert {
  return (amount, from, to) => {
    if (from === to) return amount;
    const usd = toUsd(amount, from);
    const unit = toUsd(new Decimal(1), to);
    return usd && unit && !unit.isZero() ? usd.div(unit) : null;
  };
}

/** Bank tariff "fixed + %" (A-082); `feeCurrency` null = the payment's currency. */
export type TransferFee = {
  feeFixed?: DecimalInput | null;
  feePercent?: DecimalInput | null;
  feeCurrency?: string | null;
  /** From this payment amount the fixed part is `feeStepFixed` (PrivatBank: 15 UAH from 100 000). */
  feeStepFrom?: DecimalInput | null;
  feeStepFixed?: DecimalInput | null;
};

export type Money = { amount: Decimal; currency: string };

/**
 * The fee of one transfer of `amount`: fixed + percent of the amount, in the fee currency. The
 * percent of a payment in another currency converts with `convert`; without a rate only the fixed
 * part is known. Null when the tariff is empty.
 */
export function transferFee(
  fee: TransferFee,
  amount: DecimalInput,
  currency: string,
  convert?: Convert,
): Money | null {
  const stepped =
    fee.feeStepFrom != null &&
    fee.feeStepFixed != null &&
    toDecimal(amount).gte(toDecimal(fee.feeStepFrom));
  const fixed = toDecimal((stepped ? fee.feeStepFixed : fee.feeFixed) ?? '0');
  const percent = toDecimal(fee.feePercent ?? '0');
  if (fixed.isZero() && percent.isZero()) return null;
  const feeCurrency = fee.feeCurrency ?? currency;
  const base =
    feeCurrency === currency
      ? toDecimal(amount)
      : (convert?.(toDecimal(amount), currency, feeCurrency) ?? null);
  const variable = base ? base.times(percent).div(100) : new Decimal(0);
  return { amount: roundHalfUp(fixed.plus(variable)), currency: feeCurrency };
}

export type PlannedPart = {
  id: string | null;
  name: string;
  /** Null = the rest of the expense's amount. */
  amount: DecimalInput | null;
  dueDay: number;
  monthOffset: number;
};

export type PlannedCharge = TransferFee & {
  id: string;
  name: string;
  mode: 'withheld' | 'on_top';
  ratePercent: DecimalInput;
  currency: string | null;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
};

export type PlannedExpenseRule = PlannedExpenseTerms &
  TransferFee & { name: string; amount: DecimalInput; currency: string };

export type ChargeAmount = {
  chargeId: string;
  name: string;
  mode: 'withheld' | 'on_top';
  amount: Decimal;
  currency: string;
  fee: Money | null;
};

export type PlannedInstalment = {
  partId: string | null;
  name: string;
  dueOn: LocalDate;
  /** Base of the charges; `net` is what the payee gets after withheld charges. */
  gross: Decimal;
  net: Decimal;
  currency: string;
  fee: Money | null;
  charges: ChargeAmount[];
};

/** Whether a dated rule (month-inclusive start and end) applies in `month`. */
export function activeInMonth(
  r: { startsOn: LocalDate; endsOn: LocalDate | null },
  month: LocalDate,
): boolean {
  const m = startOfMonth(month);
  return startOfMonth(r.startsOn) <= m && (r.endsOn === null || startOfMonth(r.endsOn) >= m);
}

/**
 * A charge on a base amount, rounded half-up to 2 places in the charge currency (A-082). A base in
 * another currency converts with `convert` (the NBU rate of the payout day); null without a rate.
 */
export function chargeOn(
  c: Pick<PlannedCharge, 'ratePercent' | 'currency'> & TransferFee,
  base: DecimalInput,
  baseCurrency: string,
  convert?: Convert,
): Money | null {
  const currency = c.currency ?? baseCurrency;
  const inCurrency =
    currency === baseCurrency
      ? toDecimal(base)
      : (convert?.(toDecimal(base), baseCurrency, currency) ?? null);
  if (!inCurrency) return null;
  return { amount: roundHalfUp(inCurrency.times(toDecimal(c.ratePercent)).div(100)), currency };
}

/**
 * Splits a gross amount by the charges in force (A-082): withheld charges (PIT, military levy)
 * come out of the gross, on-top ones (social contribution) are paid besides it. Checked on the
 * director's salary: 5 901.68 → PIT 1 062.30, levy 295.08, net 4 544.30, contribution 1 298.37.
 */
export function splitGross(
  gross: DecimalInput,
  currency: string,
  charges: readonly PlannedCharge[],
  convert?: Convert,
): { net: Decimal; charges: ChargeAmount[] } {
  let net = toDecimal(gross);
  const amounts: ChargeAmount[] = [];
  for (const c of charges) {
    const money = chargeOn(c, gross, currency, convert);
    if (!money) continue;
    if (c.mode === 'withheld' && money.currency === currency) net = net.minus(money.amount);
    amounts.push({
      chargeId: c.id,
      name: c.name,
      mode: c.mode,
      ...money,
      fee: transferFee(c, money.amount, money.currency, convert),
    });
  }
  return { net, charges: amounts };
}

/**
 * Payments a planned expense makes for `month` (A-082): one per part (or one for the whole amount),
 * each with its due date, net amount, transfer fee and charges. Empty when not due that month.
 */
export function plannedMonthPayments(
  e: PlannedExpenseRule,
  parts: readonly PlannedPart[],
  charges: readonly PlannedCharge[],
  month: LocalDate,
  convert?: Convert,
): PlannedInstalment[] {
  const m = startOfMonth(month);
  if (plannedExpenseDates(e, m, 1).length === 0) return [];
  const own: PlannedPart[] =
    parts.length > 0
      ? parts.slice()
      : [{ id: null, name: e.name, amount: e.amount, dueDay: e.dueDay ?? 1, monthOffset: 0 }];
  const fixed = own.filter((p) => p.amount !== null).map((p) => toDecimal(p.amount ?? '0'));
  const rest = Decimal.max(
    toDecimal(e.amount).minus(fixed.reduce((a, b) => a.plus(b), new Decimal(0))),
    0,
  );
  const active = charges.filter((c) => activeInMonth(c, m));
  return own.map((p) => {
    const gross = p.amount === null ? rest : toDecimal(p.amount);
    const split = splitGross(gross, e.currency, active, convert);
    const { year, month: mm } = toParts(addMonths(m, p.monthOffset));
    return {
      partId: p.id,
      name: p.name,
      dueOn: localDate(year, mm, Math.min(p.dueDay, daysInMonth(year, mm))),
      gross,
      net: split.net,
      currency: e.currency,
      fee: transferFee(e, split.net, e.currency, convert),
      charges: split.charges,
    };
  });
}
