import { linePaidAmounts, toDecimal, type PayoutPart } from '@tally/domain';

type Line = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  supplierActId: string | null;
};
type Adjustment = { amount: string; currency: string; supplierActId: string | null };
type Act = {
  id: string;
  amountUsd: string | null;
  amountUah: string;
  fxRate: string | null;
  rateLocked: boolean;
};
type Item = { status: string; payoutMethod: string; paidAmount: string };

/**
 * Lines as paid as the money behind them (A-110): the status column only says a line may be paid,
 * so a line is `paid` once its own act is paid or the parts split off by amount cover it.
 * `paidAmount` is what of the line is paid so far.
 */
export function withLinePayments<L extends Line>(
  item: Item,
  lines: readonly L[],
  adjustments: readonly Adjustment[],
  acts: readonly Act[],
): (L & { paidAmount: string })[] {
  const ownActs = new Map(acts.filter((a) => a.amountUsd !== null).map((a) => [a.id, a]));
  const owners = new Set(
    [...lines, ...adjustments].map((x) => x.supplierActId).filter((id) => id !== null),
  );
  const inRest = (x: { supplierActId: string | null }) =>
    x.supplierActId === null || !ownActs.has(x.supplierActId) || !owners.has(x.supplierActId);
  // Crypto and USD payouts have no acts: what was paid is a single part in USD.
  const parts: PayoutPart[] =
    item.payoutMethod === 'fiat'
      ? acts
          .filter((a) => a.rateLocked && a.amountUsd !== null && !owners.has(a.id))
          .map((a) => ({ usd: a.amountUsd ?? '0', uah: a.amountUah, rate: a.fxRate }))
      : [{ usd: item.paidAmount, uah: '0', rate: null }];
  const fromParts = linePaidAmounts(lines.filter(inRest), adjustments.filter(inRest), parts);
  return lines.map((l) => {
    const paid =
      item.status === 'paid' || (!inRest(l) && ownActs.get(l.supplierActId ?? '')?.rateLocked)
        ? toDecimal(l.amount)
        : (fromParts.get(l.id) ?? toDecimal('0'));
    const settled = toDecimal(l.amount).gt(0) && paid.gte(l.amount);
    const status = (settled ? 'paid' : l.status) as L['status'];
    return { ...l, status, paidAmount: paid.toFixed(2) };
  });
}
