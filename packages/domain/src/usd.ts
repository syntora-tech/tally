import type { LocalDate } from './local-date';
import { Decimal, toDecimal, type DecimalInput } from './money';

export type FxQuote = { onDate: LocalDate; base: string; quote: string; rate: DecimalInput };

const USD_PEGGED = ['USD', 'USDT', 'USDC'];

/**
 * Converts amounts to USD with the latest stored rate of each pair (spec 5.4: USDT/USDC = 1 USD).
 * A currency without a rate converts to `null`, so callers show it apart instead of guessing.
 */
export function usdConverter(quotes: readonly FxQuote[]) {
  const latest = new Map<string, Decimal>();
  const dates = new Map<string, LocalDate>();
  for (const q of quotes) {
    const key = `${q.base}/${q.quote}`;
    const seen = dates.get(key);
    if (seen === undefined || q.onDate > seen) {
      latest.set(key, toDecimal(q.rate));
      dates.set(key, q.onDate);
    }
  }
  const usdPerUnit = (currency: string): Decimal | null => {
    if (USD_PEGGED.includes(currency)) return new Decimal(1);
    const direct = latest.get(`${currency}/USD`);
    if (direct) return direct;
    const inverse = latest.get(`USD/${currency}`);
    if (inverse) return new Decimal(1).div(inverse);
    const viaUah = latest.get(`${currency}/UAH`);
    const usdUah = latest.get('USD/UAH');
    return viaUah && usdUah ? viaUah.div(usdUah) : null;
  };
  return (amount: DecimalInput, currency: string): Decimal | null => {
    const rate = usdPerUnit(currency);
    return rate ? toDecimal(amount).times(rate) : null;
  };
}

export type ToUsd = ReturnType<typeof usdConverter>;
