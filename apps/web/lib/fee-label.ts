import { toDecimal } from '@tally/domain';
import type { Formatter } from './format';

/** "5.00 UAH + 1 %" for a bank tariff (A-082); null when it is empty. */
export function feeLabel(
  fee: { feeFixed: string | null; feePercent: string | null; feeCurrency: string | null } | null,
  fmt: Formatter,
  currency: string,
): string | null {
  if (!fee) return null;
  const fixed = fee.feeFixed && !toDecimal(fee.feeFixed).isZero() ? fee.feeFixed : null;
  const percent = fee.feePercent && !toDecimal(fee.feePercent).isZero() ? fee.feePercent : null;
  const parts = [
    fixed && fmt.amount(fixed, fee.feeCurrency ?? currency),
    percent && `${toDecimal(percent).toString()} %`,
  ].filter(Boolean);
  return parts.length ? parts.join(' + ') : null;
}
