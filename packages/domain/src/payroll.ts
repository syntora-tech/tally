import { err, ok, type Result } from 'neverthrow';
import type { WorkCalendar } from './calendar';
import { payoutDeadline } from './date-rules';
import { addDays, compareLocalDate, type LocalDate } from './local-date';
import { Decimal, roundHalfUp, sum, toDecimal, type DecimalInput } from './money';

export type PayoutMethod = 'fiat' | 'crypto';
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
