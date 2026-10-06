import type { DbTransaction } from '@tally/db';
import { paymentCharge, plannedPayment } from '@tally/db/schema';
import { activeInMonth, chargeOn, startOfMonth, transferFee, type LocalDate } from '@tally/domain';
import { eq } from 'drizzle-orm';
import { nbuConverterOn } from '../fx';
import { chargeOf } from './sync';

/**
 * Taxes on one payout to a person (A-082), e.g. 20 % on top of every payout to Andrii: one planned
 * payment per charge in force, due the payout day, in the charge currency at that day's NBU rate.
 * They go with the payout allocation when it is removed.
 */
export async function chargePayout(
  tx: DbTransaction,
  payout: {
    allocationId: string;
    personId: string;
    amount: string;
    currency: string;
    occurredOn: LocalDate;
  },
) {
  const charges = (
    await tx.select().from(paymentCharge).where(eq(paymentCharge.personId, payout.personId))
  )
    .map(chargeOf)
    .filter((c) => activeInMonth(c, payout.occurredOn));
  if (charges.length === 0) return [];
  const convert = await nbuConverterOn(tx, payout.occurredOn);
  const missing: string[] = [];
  for (const c of charges) {
    const tax = chargeOn(c, payout.amount, payout.currency, convert);
    if (!tax) {
      missing.push(c.currency ?? payout.currency);
      continue;
    }
    const fee = transferFee(c, tax.amount, tax.currency, convert);
    const [rule] = await tx.select().from(paymentCharge).where(eq(paymentCharge.id, c.id));
    if (!rule) continue;
    await tx
      .insert(plannedPayment)
      .values({
        sourceAllocationId: payout.allocationId,
        chargeId: c.id,
        personId: payout.personId,
        month: startOfMonth(payout.occurredOn),
        dueOn: payout.occurredOn,
        name: c.name,
        categoryId: rule.categoryId,
        counterparty: rule.counterparty,
        gross: payout.amount,
        amount: tax.amount.toFixed(2),
        currency: tax.currency,
        feeAmount: fee ? fee.amount.toFixed(2) : null,
        feeCurrency: fee?.currency ?? null,
      })
      .onConflictDoNothing();
  }
  return missing;
}
