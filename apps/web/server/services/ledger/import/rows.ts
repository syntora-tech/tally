import { z } from 'zod';
import { TX_TYPES } from '..';

/** Where a suggestion came from; the preview shows it so the person knows what to check. */
export const SUGGESTION_SOURCES = ['payee', 'wallet', 'history', 'rule', 'pair', 'ai'] as const;

export const suggestion = z.object({
  type: z.enum(TX_TYPES),
  categoryId: z.uuid().nullable(),
  personId: z.uuid().nullable(),
  clientId: z.uuid().nullable(),
  /** Proposed Ledger description; null keeps the statement purpose. */
  description: z.string().nullable(),
  source: z.enum(SUGGESTION_SOURCES),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().nullable(),
});
export type Suggestion = z.infer<typeof suggestion>;

/**
 * - `new`: not in the Ledger yet.
 * - `duplicate`: already booked under this reference (or as part of an exchange) — never written.
 * - `match`: a Ledger row with the same account, date and amount but no reference — confirming
 *   links it (writes the reference) instead of booking it twice.
 * - `possible_duplicate`: same account, date and amount but another reference — off by default.
 * - `before_opening`: dated before the account's opening date, already in its opening balance.
 * - `fee_for_existing`: the bank fee of a payment already in the Ledger (`existingId`) that does not
 *   carry it yet — confirming puts it into that transaction's fee (replacing `replacesFee`).
 * - `returned`: a payment the bank rejected and its return; together no movement, never written.
 */
export const ROW_STATUSES = [
  'new',
  'duplicate',
  'match',
  'possible_duplicate',
  'before_opening',
  'fee_for_existing',
  'returned',
] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];

const leg = z.object({ accountId: z.uuid(), amount: z.string() });

/** One statement row or chain transfer, as read; the facts here are never edited by the person. */
export const importRow = z.object({
  key: z.string(),
  accountId: z.uuid(),
  occurredOn: z.string(),
  direction: z.enum(['in', 'out']),
  amount: z.string(),
  currency: z.string(),
  externalRef: z.string(),
  /** Bank reference or transaction hash as in the source. */
  ref: z.string().nullable(),
  docNumber: z.string().nullable(),
  purpose: z.string().nullable(),
  counterparty: z.string().nullable(),
  counterpartyTaxId: z.string().nullable(),
  counterpartyAccount: z.string().nullable(),
  ourAccount: z.string().nullable(),
  counterpartyAddress: z.string().nullable(),
  network: z.string().nullable(),
  /** Network fee read from the chain, on the gas account (A-065). */
  fee: leg.nullable(),
  source: z.object({ file: z.string().nullable(), line: z.number().nullable() }),
  status: z.enum(ROW_STATUSES),
  existingId: z.uuid().nullable(),
  /** The fee `existingId` carries now (e.g. the estimate of Pay) that the bank fee replaces. */
  replacesFee: leg.nullable().optional(),
  /** Proposed: this row is the other leg or the fee of that row. */
  attachTo: z.string().nullable(),
  flags: z.array(z.string()),
  suggestion: suggestion.nullable(),
});
export type ImportRow = z.infer<typeof importRow>;

export const importRows = z.array(importRow);

/** Rows that can be written: everything not already in the Ledger or its opening balance. */
export const isBookable = (r: Pick<ImportRow, 'status'>) =>
  r.status === 'new' ||
  r.status === 'possible_duplicate' ||
  r.status === 'match' ||
  r.status === 'fee_for_existing';

/** Rows that change a Ledger transaction instead of booking one. */
export const editsExisting = (r: Pick<ImportRow, 'status'>) =>
  r.status === 'match' || r.status === 'fee_for_existing';

/** Default of the include checkbox. */
export const includedByDefault = (r: ImportRow) =>
  (r.status === 'new' || editsExisting(r)) && !r.flags.includes('dust');

/** The person's choice for one row, sent with the commit. */
export const decision = z.object({
  key: z.string(),
  include: z.boolean(),
  type: z.enum(TX_TYPES),
  categoryId: z.uuid().nullable(),
  personId: z.uuid().nullable(),
  clientId: z.uuid().nullable(),
  description: z.string().trim().max(10_000).nullable(),
  attachTo: z.string().nullable(),
});
export type Decision = z.infer<typeof decision>;

export const MAX_IMPORT_ROWS = 1000;
