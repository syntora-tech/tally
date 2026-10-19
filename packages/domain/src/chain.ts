import { Decimal } from './money';
import type { CryptoNetwork } from './crypto';

/**
 * Tokens the crypto import reads (A-122). Only these contracts count: address-poisoning spam
 * sends look-alike tokens with the same symbol from other contracts.
 */
export type TokenContract = { symbol: string; contract: string; decimals: number };

export const TOKEN_CONTRACTS: Partial<Record<CryptoNetwork, readonly TokenContract[]>> = {
  ETH: [
    { symbol: 'USDT', contract: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
    { symbol: 'USDC', contract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
  ],
  TRON: [{ symbol: 'USDT', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6 }],
};

/** Native coin paying the network fee, booked on the gas account (A-065). */
export const GAS_COINS: Partial<Record<CryptoNetwork, { symbol: string; decimals: number }>> = {
  ETH: { symbol: 'ETH', decimals: 18 },
  TRON: { symbol: 'TRX', decimals: 6 },
};

export function tokenContract(network: CryptoNetwork, contract: string): TokenContract | null {
  const wanted = network === 'TRON' ? contract : contract.toLowerCase();
  return TOKEN_CONTRACTS[network]?.find((t) => t.contract === wanted) ?? null;
}

/** Integer base units (wei, sun) → decimal string, exactly; null for anything but digits. */
export function fromBaseUnits(value: string, decimals: number): string | null {
  if (!/^\d+$/.test(value)) return null;
  return new Decimal(value).div(new Decimal(10).pow(decimals)).toFixed();
}

/**
 * A network fee in the precision of `numeric(20,8)`, rounded half-up; a fee that rounds to zero
 * is no fee posting at all (postings are never 0).
 */
export function feeAmount(value: string): string | null {
  const rounded = new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP);
  return rounded.gt(0) ? rounded.toFixed() : null;
}

/** Inbound transfers below this many token units from unknown wallets are treated as dust. */
export const DUST_LIMIT = '1';
