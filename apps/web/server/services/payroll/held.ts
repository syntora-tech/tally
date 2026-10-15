import { sum, toDecimal } from '@tally/domain';

type Line = { status: string; amount: string; currency: string };
type Item = {
  status: string;
  payoutMethod: string;
  payoutFxRate: string | null;
  paidAmount: string;
};

/** What the lines still held back (not released) are worth in the payout's currency. */
export function heldValue(lines: readonly Line[], item: Omit<Item, 'status' | 'paidAmount'>) {
  const held = lines.filter((l) => l.status !== 'payable' && l.status !== 'paid');
  const usd = sum(held.filter((l) => l.currency !== 'UAH').map((l) => l.amount));
  if (item.payoutMethod !== 'fiat') return usd;
  const uah = sum(held.filter((l) => l.currency === 'UAH').map((l) => l.amount));
  return usd.times(toDecimal(item.payoutFxRate ?? '0')).plus(uah);
}

export type PayrollGroup = 'ready' | 'waiting' | 'paid';

/** A part paid with the rest held for the client leaves nothing to pay now: it waits. */
export function payrollGroup(item: Item, total: string | null, lines: readonly Line[]) {
  if (item.status === 'paid') return 'paid';
  if (item.status === 'draft') return 'waiting';
  const nothingNow =
    item.status === 'partially_paid' &&
    total !== null &&
    toDecimal(total).minus(heldValue(lines, item)).lte(toDecimal(item.paidAmount));
  return nothingNow ? 'waiting' : 'ready';
}
