import { err, ok, type Result } from 'neverthrow';
import type { WorkCalendar } from './calendar';
import { payoutDeadline } from './date-rules';
import {
  addDays,
  compareLocalDate,
  daysInMonth,
  endOfMonth,
  localDate,
  startOfMonth,
  toParts,
  type LocalDate,
} from './local-date';
import { Decimal, roundHalfUp, sum, toDecimal, type DecimalInput } from './money';

/** `bank_usd`: USD from a USD bank account, e.g. a SWIFT abroad — no UAH rate, no FOP act (A-084). */
export type PayoutMethod = 'fiat' | 'crypto' | 'bank_usd';
export type ReleasePolicy = 'immediate' | 'on_payment_or_due';
export type FundingSource = 'client' | 'company';

/** USD-pegged stablecoins count as USD in v1 (spec 5.4, Q15). */
const USD_LIKE = new Set(['USD', 'USDT', 'USDC']);

export type PayeeCandidate = { id: string; kind: 'fop' | 'crypto' | 'other' };

/**
 * Payee of a payroll line (5.2): crypto pay goes to the person's crypto wallet payee, fiat to the
 * default payee (usually the FOP). Null when the person has no matching payee yet.
 */
export function resolvePayee(
  method: PayoutMethod,
  defaultPayeeId: string | null,
  payees: readonly PayeeCandidate[],
): string | null {
  if (method === 'crypto') return payees.find((p) => p.kind === 'crypto')?.id ?? null;
  const preferred = payees.find((p) => p.id === defaultPayeeId && p.kind !== 'crypto');
  return preferred?.id ?? payees.find((p) => p.kind !== 'crypto')?.id ?? null;
}

export type AdjustmentInput = { amount: DecimalInput; currency: string };

/** A payroll line in the currency of its pay terms: USD or UAH (A-075). */
export type PayLineInput = { amount: DecimalInput; currency: string };

export type PayrollTotalError =
  { code: 'unsupported_currency'; currency: string } | { code: 'rate_required' };

/** USD part of a payroll item: USD lines plus USD adjustments, before conversion. */
export function payrollTotalUsd(
  lines: readonly PayLineInput[],
  adjustments: readonly AdjustmentInput[],
): Decimal {
  return roundHalfUp(
    sum([...lines, ...adjustments].filter((x) => USD_LIKE.has(x.currency)).map((x) => x.amount)),
  );
}

/** UAH part of a payroll item: UAH lines plus UAH adjustments, paid as they are. */
export function payrollPartUah(
  lines: readonly PayLineInput[],
  adjustments: readonly AdjustmentInput[],
): Decimal {
  return sum([...lines, ...adjustments].filter((x) => x.currency === 'UAH').map((x) => x.amount));
}

/**
 * total_uah = round2(USD part × payout_fx) + UAH part (spec 5.2, A-075). Check: 2 020 × 44.48 +
 * 3 325 = 93 174.60 (act 1002 - А8). A rate is needed only when there is a USD part.
 */
export function payrollTotalUah(
  lines: readonly PayLineInput[],
  adjustments: readonly AdjustmentInput[],
  payoutFx: DecimalInput | null,
): Result<Decimal, PayrollTotalError> {
  const foreign = [...lines, ...adjustments].find(
    (x) => !USD_LIKE.has(x.currency) && x.currency !== 'UAH',
  );
  if (foreign) return err({ code: 'unsupported_currency', currency: foreign.currency });
  const usd = payrollTotalUsd(lines, adjustments);
  const uah = payrollPartUah(lines, adjustments);
  if (usd.isZero()) return ok(uah);
  if (payoutFx === null) return err({ code: 'rate_required' });
  return ok(roundHalfUp(usd.times(toDecimal(payoutFx))).plus(uah));
}

export type InvoiceState = { total: DecimalInput; paidAmount: DecimalInput; dueDate: LocalDate };

export type Payability =
  { payable: true; funding: FundingSource } | { payable: false; deadline: LocalDate };

/**
 * Pay-when-paid with company funding (5.3): payable once the client paid the invoice in full, or
 * on the payout deadline at the company's expense, whichever comes first. Partial payment does not
 * release the line.
 */
export function resolvePayability(
  invoice: InvoiceState | null,
  terms: { releasePolicy: ReleasePolicy; graceDays: number },
  today: LocalDate,
  cal: WorkCalendar,
): Payability {
  if (!invoice || terms.releasePolicy === 'immediate') return { payable: true, funding: 'company' };
  if (toDecimal(invoice.paidAmount).gte(toDecimal(invoice.total))) {
    return { payable: true, funding: 'client' };
  }
  const deadline = payoutDeadline(invoice.dueDate, terms.graceDays, cal);
  if (compareLocalDate(today, deadline) >= 0) return { payable: true, funding: 'company' };
  return { payable: false, deadline };
}

export type LineStatus = 'accrued' | 'awaiting_client' | 'payable' | 'paid';
export type ItemStatus = 'draft' | 'partially_payable' | 'payable' | 'partially_paid' | 'paid';

/** Item status from its lines (5.3 rule 6); `paid` amounts come from allocations. */
export function payrollItemStatus(
  lines: readonly LineStatus[],
  paid: DecimalInput,
  total: DecimalInput,
): ItemStatus {
  const p = toDecimal(paid);
  if (lines.length > 0 && p.gte(toDecimal(total)) && p.gt(0)) return 'paid';
  if (p.gt(0)) return 'partially_paid';
  const ready = lines.filter((s) => s === 'payable' || s === 'paid').length;
  if (lines.length > 0 && ready === lines.length) return 'payable';
  return ready > 0 ? 'partially_payable' : 'draft';
}

const RATE_DP = 6;

/** Rate implied by two actual amounts (5.4): 2 000 USD → 86 100 UAH = 43.050000. */
export function derivedRate(base: DecimalInput, quote: DecimalInput): Decimal {
  return toDecimal(quote)
    .abs()
    .div(toDecimal(base).abs())
    .toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP);
}

export type FxSource = 'bank_actual' | 'nbu' | 'manual';

export type FxCandidates = {
  /** USD→UAH exchanges from the Ledger: both legs as actually booked. */
  exchanges: readonly { occurredOn: LocalDate; usd: DecimalInput; uah: DecimalInput }[];
  nbu: { onDate: LocalDate; rate: DecimalInput } | null;
  lastManual: { onDate: LocalDate; rate: DecimalInput } | null;
};

export type SuggestedRate = { rate: Decimal; source: FxSource; onDate: LocalDate };

/**
 * Payout rate suggestion (5.4): the latest Ledger exchange within 3 calendar days, else the NBU
 * rate for the date, else the last manual rate. The field always stays editable.
 */
export function suggestPayoutRate(on: LocalDate, c: FxCandidates): SuggestedRate | null {
  const from = addDays(on, -3);
  const recent = c.exchanges
    .filter((e) => e.occurredOn >= from && e.occurredOn <= on)
    .sort((a, b) => compareLocalDate(b.occurredOn, a.occurredOn))[0];
  if (recent) {
    return {
      rate: derivedRate(recent.usd, recent.uah),
      source: 'bank_actual',
      onDate: recent.occurredOn,
    };
  }
  if (c.nbu) return { rate: toDecimal(c.nbu.rate), source: 'nbu', onDate: c.nbu.onDate };
  if (c.lastManual) {
    return { rate: toDecimal(c.lastManual.rate), source: 'manual', onDate: c.lastManual.onDate };
  }
  return null;
}

/** A part of a month's payout paid on its own, with its own act and rate (A-083). */
export type PayoutPart = { usd: DecimalInput; uah: DecimalInput; rate: DecimalInput | null };

export type PayoutRest = { usd: Decimal; uah: Decimal };

/**
 * What of a payout is left after its parts (A-083): the USD share not yet covered and the UAH
 * lines/adjustments not yet covered (a part's UAH beyond its USD × rate came from them).
 */
export function payoutRest(
  lines: readonly PayLineInput[],
  adjustments: readonly AdjustmentInput[],
  parts: readonly PayoutPart[],
): PayoutRest {
  let usd = payrollTotalUsd(lines, adjustments);
  let uah = payrollPartUah(lines, adjustments);
  for (const p of parts) {
    const ownUsd = toDecimal(p.usd);
    usd = usd.minus(ownUsd);
    const fromUsd = p.rate === null ? new Decimal(0) : roundHalfUp(ownUsd.times(toDecimal(p.rate)));
    uah = uah.minus(toDecimal(p.uah).minus(fromUsd));
  }
  return { usd: Decimal.max(usd, 0), uah: Decimal.max(uah, 0) };
}

/** The rest in UAH at a rate: round2(USD × rate) + UAH, as total_uah (5.2). */
export function payoutRestUah(rest: PayoutRest, rate: DecimalInput | null): Decimal | null {
  if (rest.usd.isZero()) return rest.uah;
  if (rate === null) return null;
  return roundHalfUp(rest.usd.times(toDecimal(rate))).plus(rest.uah);
}

/**
 * The part a payment of `paidUah` covers (A-083): USD first, at the payment rate, then the UAH
 * lines. A payment of the whole rest covers it all, so no cents are left over by rounding.
 */
export function payoutPartOf(
  rest: PayoutRest,
  paidUah: DecimalInput,
  rate: DecimalInput | null,
): { usd: Decimal; uah: Decimal; coversRest: boolean } {
  const paid = toDecimal(paidUah);
  const restUah = payoutRestUah(rest, rate);
  if (restUah !== null && paid.gte(restUah)) return { usd: rest.usd, uah: paid, coversRest: true };
  if (rest.usd.isZero() || rate === null)
    return { usd: new Decimal(0), uah: paid, coversRest: false };
  const usd = Decimal.min(paid.div(toDecimal(rate)).toDecimalPlaces(8), rest.usd);
  return { usd, uah: paid, coversRest: false };
}

/**
 * Act period of the next part of a month's payout (A-083): from the first day no act covers yet to
 * the payout day moved into the month of work (same day of month, clamped to it); a part that
 * pays the rest runs to the month's end. Null when the month is already covered.
 */
export function nextPartPeriod(
  month: LocalDate,
  covered: readonly { from: LocalDate; to: LocalDate }[],
  paidOn: LocalDate,
  coversRest: boolean,
): { from: LocalDate; to: LocalDate } | null {
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const lastCovered = covered
    .map((c) => c.to)
    .reduce<LocalDate | null>((a, b) => (a === null || b > a ? b : a), null);
  const from = lastCovered === null ? first : addDays(lastCovered, 1);
  if (from > last) return null;
  if (coversRest) return { from, to: last };
  const { year, month: m } = toParts(first);
  const day = Math.min(toParts(paidOn).day, daysInMonth(year, m));
  const sameMonthDay = localDate(year, m, day);
  return { from, to: sameMonthDay < from ? from : sameMonthDay };
}
