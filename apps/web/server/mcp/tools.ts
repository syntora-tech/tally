import type { McpProfile } from '@tally/db/schema';
import type { z } from 'zod';
import type { ServiceContext } from '../services/context';
import type { Service, ServiceResult } from '../services/define-service';
import { listRates } from '../services/fx';
import { listAccounts, listCategories, listTransactions } from '../services/ledger';
import {
  addTransactions,
  setFxRates,
  upsertAccounts,
  upsertCategories,
} from '../services/ledger/batch';

export type ToolKind = 'read' | 'write';

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  input: z.ZodType;
  run: (ctx: ServiceContext, rawInput: unknown) => Promise<ServiceResult<unknown>>;
  /** Shapes the service result for agents; defaults to the raw value. */
  present: (value: unknown) => unknown;
};

/** Keeps each tool's `present` typed against its own service result. */
function tool<S extends z.ZodType, T>(
  def: Pick<ToolDef, 'name' | 'title' | 'description' | 'kind'> & {
    service: Service<S, T>;
    present?: (value: T) => unknown;
  },
): ToolDef {
  const { service, present, ...meta } = def;
  return {
    ...meta,
    input: service.input,
    run: (ctx, raw) => service.run(ctx, raw),
    present: (value) => (present ? present(value as T) : value),
  };
}

/**
 * Tools v1 for the Ledger (spec 13.3, narrowed and written directly per A-054). Deletions, payouts,
 * allocations and document actions are deliberately absent from MCP (13.3 «не виставляються»).
 */
export const TOOLS: readonly ToolDef[] = [
  tool({
    name: 'get_balances',
    title: 'Account balances',
    description:
      'Ledger accounts (bank, crypto, cash) with currency, opening balance/date and the current balance = opening + all postings. Amounts are decimal strings in the account currency.',
    kind: 'read',
    service: listAccounts,
    present: (rows) =>
      rows.map(({ account: a, balance }) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        currency: a.currency,
        network: a.network,
        openingBalance: a.openingBalance,
        openingDate: a.openingDate,
        isActive: a.isActive,
        balance,
      })),
  }),
  tool({
    name: 'list_categories',
    title: 'Transaction categories',
    description:
      'Categories by transaction type. A transaction must use a category of its own type.',
    kind: 'read',
    service: listCategories,
    present: (rows) => rows.map(({ id, txType, name }) => ({ id, txType, name })),
  }),
  tool({
    name: 'list_transactions',
    title: 'Ledger journal',
    description:
      'Transactions with postings, newest first. Filters: from/to (YYYY-MM-DD), type, categoryId, accountId, unallocated, limit (max 1000). Posting amounts are signed decimal strings: negative = money out.',
    kind: 'read',
    service: listTransactions,
    present: (rows) =>
      rows.map(({ transaction: t, categoryName, allocated, postings }) => ({
        id: t.id,
        occurredOn: t.occurredOn,
        type: t.type,
        category: categoryName,
        description: t.description,
        counterparty: t.counterparty,
        externalRef: t.externalRef ?? t.legacyRef,
        allocated,
        postings: postings.map((p) => ({
          account: p.accountName,
          amount: p.amount,
          currency: p.currency,
          isFee: p.isFee,
        })),
      })),
  }),
  tool({
    name: 'list_fx_rates',
    title: 'FX rates',
    description:
      'Stored FX rates, newest first: base, quote, rate (quote units per 1 base), source nbu|bank_actual|manual.',
    kind: 'read',
    service: listRates,
    present: (rows) =>
      rows.map(({ onDate, base, quote, rate, source }) => ({ onDate, base, quote, rate, source })),
  }),
  tool({
    name: 'upsert_accounts',
    title: 'Create or update accounts',
    description:
      'Creates accounts or updates them by exact name (max 100). The currency of an account that already has postings cannot change. All-or-nothing; use dryRun to preview.',
    kind: 'write',
    service: upsertAccounts,
  }),
  tool({
    name: 'upsert_categories',
    title: 'Add categories',
    description:
      'Adds categories by (txType, name), max 200; existing ones are reported as "existing". All-or-nothing; use dryRun to preview.',
    kind: 'write',
    service: upsertCategories,
  }),
  tool({
    name: 'set_fx_rates',
    title: 'Set manual FX rates',
    description:
      'Stores manual rates (max 500); a rate for the same date and pair replaces the previous manual one. Rate = quote units per 1 base, e.g. base USD quote UAH rate "41.25".',
    kind: 'write',
    service: setFxRates,
  }),
  tool({
    name: 'add_transactions',
    title: 'Add transactions',
    description:
      'Books up to 500 transactions. Amounts are positive decimal strings in the account currency; the leg gives the sign: revenue → to, expense → from, transfer/fx_exchange/crypto_* → from + to, adjustment → exactly one of from/to; fee is optional and always booked negative. Items whose externalRef already exists are skipped as "duplicate", so a batch can be re-sent. Any invalid item rolls back the whole batch and errors are keyed "transactions.<index>". Use dryRun first.',
    kind: 'write',
    service: addTransactions,
  }),
];

export function toolsFor(profile: McpProfile, allowedTools: readonly string[] | null) {
  switch (profile) {
    case 'read_only':
      return TOOLS.filter((t) => t.kind === 'read');
    case 'assistant':
      return [...TOOLS];
    case 'custom':
      return TOOLS.filter((t) => allowedTools?.includes(t.name));
  }
}

export const RATE_LIMITS: Record<ToolKind, number> = { read: 120, write: 30 };
