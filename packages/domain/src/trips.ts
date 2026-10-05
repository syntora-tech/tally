import type { LocalDate } from './local-date';
import { Decimal, roundHalfUp, sum, toDecimal, type DecimalInput } from './money';

const USD_PEGGED = ['USD', 'USDT', 'USDC'];

/**
 * UAH and USD values of a trip expense (6.8): UAH at the expense's own rate (UAH per unit, NBU
 * on the date by default), USD at the USD→UAH rate of the same day unless it is already dollars.
 */
export function tripExpenseAmounts(
  amount: DecimalInput,
  currency: string,
  uahPerUnit: DecimalInput,
  uahPerUsd: DecimalInput,
): { amountUah: string; amountUsd: string } {
  const uah = roundHalfUp(toDecimal(amount).times(toDecimal(uahPerUnit)), 2);
  const usd = USD_PEGGED.includes(currency)
    ? toDecimal(amount)
    : uah.div(toDecimal(uahPerUsd)).toDecimalPlaces(8);
  return { amountUah: uah.toFixed(2), amountUsd: usd.toFixed(8) };
}

export type TripExpenseLine = {
  personId: string;
  amountUah: DecimalInput;
  amountUsd: DecimalInput;
  reimbursable: boolean;
  paidBy: 'person' | 'company';
};

export type TripReimbursementLine = { personId: string; paidUah: DecimalInput };

export type ParticipantSummary = {
  personId: string;
  spentUah: string;
  spentUsd: string;
  toReimburseUah: string;
  toReimburseUsd: string;
  reimbursedUah: string;
  remainingUah: string;
  /** At the average rate of the person's reimbursable expenses. */
  remainingUsd: string;
};

/** Per participant (6.8): spent, to reimburse, reimbursed and what is left, UAH and USD. */
export function tripSummary(
  personIds: readonly string[],
  expenses: readonly TripExpenseLine[],
  reimbursements: readonly TripReimbursementLine[],
): ParticipantSummary[] {
  return personIds.map((personId) => {
    const own = expenses.filter((e) => e.personId === personId);
    const due = own.filter((e) => e.reimbursable && e.paidBy === 'person');
    const dueUah = sum(due.map((e) => e.amountUah));
    const dueUsd = sum(due.map((e) => e.amountUsd));
    const reimbursed = sum(
      reimbursements.filter((r) => r.personId === personId).map((r) => r.paidUah),
    );
    const remaining = Decimal.max(dueUah.minus(reimbursed), '0');
    const remainingUsd = dueUah.isZero() ? new Decimal(0) : remaining.times(dueUsd).div(dueUah);
    return {
      personId,
      spentUah: sum(own.map((e) => e.amountUah)).toFixed(2),
      spentUsd: sum(own.map((e) => e.amountUsd)).toFixed(2),
      toReimburseUah: dueUah.toFixed(2),
      toReimburseUsd: dueUsd.toFixed(2),
      reimbursedUah: reimbursed.toFixed(2),
      remainingUah: remaining.toFixed(2),
      remainingUsd: remainingUsd.toFixed(2),
    };
  });
}

export type TripStatus = 'planned' | 'in_progress' | 'awaiting_reimbursement' | 'settled';

/**
 * Trip status (6.8, A-070) from its dates and what is left to reimburse; a trip without dates
 * (legacy) is judged by the money only.
 */
export function tripStatus(
  trip: { startsOn: LocalDate | null; endsOn: LocalDate | null },
  remainingUah: DecimalInput,
  today: LocalDate,
): TripStatus {
  if (trip.startsOn && today < trip.startsOn) return 'planned';
  if (trip.endsOn && today <= trip.endsOn) return 'in_progress';
  return toDecimal(remainingUah).gt(0) ? 'awaiting_reimbursement' : 'settled';
}

/** Key for spotting one receipt entered in two trips: date + amount + description (6.8 AC). */
export function receiptKey(e: {
  spentOn: string | null;
  amount: DecimalInput;
  currency: string;
  description: string;
}): string {
  return [
    e.spentOn ?? '',
    toDecimal(e.amount).toFixed(2),
    e.currency,
    e.description.trim().toLowerCase().replace(/\s+/g, ' '),
  ].join('|');
}
