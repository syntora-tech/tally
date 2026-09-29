import DecimalBase from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

/** decimal.js instance for all money math: generous precision, half-up rounding (spec 5.1, 5.4). */
export const Decimal = DecimalBase.clone({
  precision: 40,
  rounding: DecimalBase.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
});
export type Decimal = InstanceType<typeof Decimal>;

export type DecimalInput = string | Decimal;

/** Scales used by the DB schema (spec 4.2). */
export const SCALE = {
  amount: 8,
  rate: 6,
  uah: 2,
} as const;

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export type ParseDecimalError = { code: 'invalid_decimal'; input: string };

/** Strict parser for decimal strings coming from the DB or user input; rejects exponents, commas, blanks. */
export function parseDecimal(input: string): Result<Decimal, ParseDecimalError> {
  const trimmed = input.trim();
  if (!DECIMAL_STRING.test(trimmed)) return err({ code: 'invalid_decimal', input });
  return ok(new Decimal(trimmed));
}

export function toDecimal(value: DecimalInput): Decimal {
  if (typeof value !== 'string') return value;
  return parseDecimal(value).match(
    (d) => d,
    (e) => {
      throw new Error(`Invalid decimal string: "${e.input}"`);
    },
  );
}

/** Round to `dp` places half-up (default 2 — line amounts, UAH totals). */
export function roundHalfUp(value: DecimalInput, dp = 2): Decimal {
  return toDecimal(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

export function sum(values: readonly DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/** Serialize for a `numeric(p, scale)` column; values are rounded half-up to the scale. */
export function toDbNumeric(value: DecimalInput, scale: number): string {
  return toDecimal(value).toFixed(scale, Decimal.ROUND_HALF_UP);
}

const NARROW_NBSP = ' ';

export type FormatAmountOptions = {
  /** Fraction digits to show; defaults to 2. */
  dp?: number;
};

/**
 * Formats `93174.6` as `93 174.60` (narrow no-break space groups, dot decimal) — see assumptions A-004.
 * Works on the decimal string, never through a JS number.
 */
export function formatAmount(
  value: DecimalInput,
  currency?: string,
  options: FormatAmountOptions = {},
): string {
  const fixed = toDecimal(value).toFixed(options.dp ?? 2, Decimal.ROUND_HALF_UP);
  const negative = fixed.startsWith('-');
  const [intPart = '0', fracPart] = (negative ? fixed.slice(1) : fixed).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  const isZero = /^[0.]+$/.test(negative ? fixed.slice(1) : fixed);
  const number = `${negative && !isZero ? '-' : ''}${grouped}${fracPart ? `.${fracPart}` : ''}`;
  return currency ? `${number}${NARROW_NBSP}${currency}` : number;
}
