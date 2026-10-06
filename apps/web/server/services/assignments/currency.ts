import type { DbTransaction } from '@tally/db';
import { assignment, contract } from '@tally/db/schema';
import { eq } from 'drizzle-orm';
import { msg } from '../errors';

/** Currency of the assignment's contract; null for internal assignments. */
export async function contractCurrency(
  tx: DbTransaction,
  ref: { contractId: string | null } | { assignmentId: string },
): Promise<string | null> {
  if ('contractId' in ref) {
    if (!ref.contractId) return null;
    const [c] = await tx
      .select({ currency: contract.currency })
      .from(contract)
      .where(eq(contract.id, ref.contractId));
    return c?.currency ?? null;
  }
  const [row] = await tx
    .select({ currency: contract.currency })
    .from(assignment)
    .leftJoin(contract, eq(contract.id, assignment.contractId))
    .where(eq(assignment.id, ref.assignmentId));
  return row?.currency ?? null;
}

/**
 * Client rates are in the contract currency, so an invoice never mixes currencies; internal work
 * has no contract and stays in USD (A-075). Returns the currency to store or an error message.
 */
export function billingCurrency(
  sent: string | undefined,
  ofContract: string | null,
): { currency: string } | { error: string } {
  const expected = ofContract ?? 'USD';
  if (sent && sent !== expected) {
    return { error: msg('assignments.billingCurrency', { currency: expected }) };
  }
  return { currency: expected };
}

/**
 * Crypto payouts go out in USD-pegged coins and `bank_usd` ones in USD, so both need USD pay
 * (A-075, A-084).
 */
export function payCurrencyProblem(pay: { currency: string; payoutMethod: string }): string | null {
  return pay.payoutMethod !== 'fiat' && pay.currency !== 'USD' ? 'assignments.cryptoPayUsd' : null;
}
