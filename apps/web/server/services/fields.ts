import {
  CRYPTO_NETWORKS,
  normalizeWalletAddress,
  parseDecimal,
  parseLocalDate,
  type LocalDate,
} from '@tally/domain';
import { z } from 'zod';

// Shared Zod building blocks for forms, services and (later) MCP tools. Money and dates stay strings.

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Trimmed text; empty input becomes null. */
export const optionalText = z
  .preprocess(emptyToNull, z.string().trim().max(10_000).nullable().optional())
  .transform((v) => v ?? null);

export const requiredText = (message = 'field.required') =>
  z.string({ error: message }).trim().min(1, message).max(1_000);

/** Decimal as a string (never a JS number), e.g. "5500" or "47.5". */
export const decimalString = z
  .string()
  .trim()
  .refine((v) => parseDecimal(v).isOk(), 'field.number');

export const nonNegativeDecimal = decimalString.refine(
  (v) => !v.startsWith('-'),
  'field.nonNegative',
);

export const optionalDecimal = z
  .preprocess(emptyToNull, nonNegativeDecimal.nullable().optional())
  .transform((v) => v ?? null);

export const localDateString = z
  .string()
  .trim()
  .refine((v) => parseLocalDate(v).isOk(), 'field.date')
  .transform((v) => v as LocalDate);

export const optionalLocalDate = z
  .preprocess(emptyToNull, localDateString.nullable().optional())
  .transform((v) => v ?? null);

/** First day of a month, as required for term versions (A-018); also accepts `YYYY-MM`. */
export const monthStart = z.preprocess(
  (v) => (typeof v === 'string' && /^\d{4}-\d{2}$/.test(v.trim()) ? `${v.trim()}-01` : v),
  localDateString.refine((v) => v.endsWith('-01'), 'field.monthStart'),
);

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,4}$/, 'field.currency');

/** Tags from a comma-separated string or repeated form fields; trimmed, de-duplicated. */
export const tagList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const raw = Array.isArray(v) ? v : (v ?? '').split(',');
    return [...new Set(raw.map((t) => t.trim()).filter((t) => t.length > 0))];
  });

export const httpUrl = z.url({ protocol: /^https?$/, error: 'field.url' }).max(2_000);

export const optionalHttpUrl = z
  .preprocess(emptyToNull, httpUrl.nullable().optional())
  .transform((v) => v ?? null);

export const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true');

export const cryptoNetwork = z.enum(CRYPTO_NETWORKS, { error: 'field.network' });

/** Network code from the fixed list (A-060); empty input becomes null. */
export const optionalNetwork = z
  .preprocess(emptyToNull, cryptoNetwork.nullable().optional())
  .transform((v) => v ?? null);

type Issue = { path: string[]; message: string };

/** Zod transform step: replaces `addressKey` with its canonical form or reports an issue. */
export function normalizeAddressIn<K extends string, A extends string>(
  networkKey: K,
  addressKey: A,
) {
  return <T extends Record<K | A, string | null>>(value: T, ctx: z.RefinementCtx): T => {
    const result = canonicalAddress(value[networkKey], value[addressKey], {
      network: networkKey,
      address: addressKey,
    });
    if ('issue' in result) {
      ctx.addIssue({ code: 'custom', ...result.issue });
      return z.NEVER;
    }
    return { ...value, [addressKey]: result.address };
  };
}

/**
 * Canonical wallet address for `network` (EVM lower-cased), or the issue to report. A missing
 * address is fine; an address without a network is not, since it cannot be validated or matched.
 */
export function canonicalAddress(
  network: string | null,
  address: string | null,
  keys: { network: string; address: string },
): { address: string | null } | { issue: Issue } {
  if (!address) return { address: null };
  if (!network) return { issue: { path: [keys.network], message: 'field.networkRequired' } };
  const normalized = normalizeWalletAddress(network as (typeof CRYPTO_NETWORKS)[number], address);
  return normalized.isOk()
    ? { address: normalized.value }
    : { issue: { path: [keys.address], message: 'field.walletAddress' } };
}
