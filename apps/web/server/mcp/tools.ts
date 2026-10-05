import type { McpProfile } from '@tally/db/schema';
import type { z } from 'zod';
import { listClients } from '../services/clients';
import { upsertClients } from '../services/clients/batch';
import type { ServiceContext } from '../services/context';
import type { Service, ServiceResult } from '../services/define-service';
import { listRates } from '../services/fx';
import { listAccounts, listCategories, listTransactions } from '../services/ledger';
import {
  addTransactions,
  deleteTransactions,
  setFxRates,
  updateTransactions,
  upsertAccounts,
  upsertCategories,
} from '../services/ledger/batch';
import { getPerson, searchPeople, type PersonRow } from '../services/people';
import { listPayees } from '../services/payees';
import { upsertPayees } from '../services/payees/batch';
import { upsertPeople } from '../services/people/batch';
import { getTrip, listTrips } from '../services/trips';
import { addTripExpenses, upsertTrips } from '../services/trips/batch';
import { findWallets, upsertWallets } from '../services/wallets';

export type ToolKind = 'read' | 'write';

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  /** Write tools that remove data are announced as destructive to MCP clients. */
  destructive?: boolean;
  input: z.ZodType;
  run: (ctx: ServiceContext, rawInput: unknown) => Promise<ServiceResult<unknown>>;
  /** Shapes the service result for agents; defaults to the raw value. */
  present: (value: unknown) => unknown;
};

/** Keeps each tool's `present` typed against its own service result. */
function tool<S extends z.ZodType, T>(
  def: Pick<ToolDef, 'name' | 'title' | 'description' | 'kind' | 'destructive'> & {
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

/** Bench profile; payee details come only from list_payees (A-062). */
function benchProfile(p: PersonRow) {
  return {
    id: p.id,
    fullName: p.fullName,
    displayName: p.displayName,
    position: p.position,
    seniority: p.seniority,
    stack: p.stack,
    domains: p.domains,
    marketRateUsd: p.marketRateUsd,
    allocation: p.allocation,
    availabilityFrom: p.availabilityFrom,
    location: p.location,
    timezone: p.timezone,
    contactOwner: p.contactOwner,
    status: p.status,
    load: p.load,
    bench: p.bench,
    notes: p.notes,
  };
}

/**
 * Tools v1 for the Ledger, people and clients (spec 13.3, narrowed and written directly per
 * A-054, A-056). Contracts, terms, payouts, allocations, document actions and deletions other
 * than unallocated transactions are deliberately absent from MCP (13.3 «не виставляються»);
 * payees are allowed since A-062, deleting transactions since A-063.
 */
export const TOOLS: readonly ToolDef[] = [
  tool({
    name: 'get_balances',
    title: 'Account balances',
    description:
      'Ledger accounts (bank, crypto, cash) with currency, opening balance/date and the balance = opening + all postings, or only those dated on or before `asOf` (to reconcile with a statement). Amounts are decimal strings in the account currency.',
    kind: 'read',
    service: listAccounts,
    present: (rows) =>
      rows.map(({ account: a, balance }) => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        currency: a.currency,
        network: a.network,
        address: a.address,
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
        personId: t.personId,
        clientId: t.clientId,
        counterpartyAddress: t.counterpartyAddress,
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
    name: 'search_people',
    title: 'Search people (bench)',
    description:
      'People with bench filters: q (name/position), stack (tags, all must match), seniority, maxRate (USD/hour, decimal string), availableOn (YYYY-MM-DD), allocation full_time|part_time, location, bench free|partial|busy (computed for today), status active|bench|inactive. Payees are never returned.',
    kind: 'read',
    service: searchPeople,
    present: (rows) => rows.map(benchProfile),
  }),
  tool({
    name: 'get_person',
    title: 'Person profile',
    description:
      'One person by id: bench profile, current load, crypto wallets (network, address, label, isActive) and the default payee {id, name}; payee details are in list_payees.',
    kind: 'read',
    service: getPerson,
    present: (p) => ({ ...benchProfile(p), wallets: p.wallets, defaultPayee: p.defaultPayee }),
  }),
  tool({
    name: 'list_clients',
    title: 'Clients',
    description:
      'Clients with legal and short name, country, default currency, the number of contracts and crypto wallets (network, address, label, isActive).',
    kind: 'read',
    service: listClients,
  }),
  tool({
    name: 'find_wallets',
    title: 'Find wallet owners',
    description:
      'Crypto wallets of people and clients with their owner, plus our own accounts with that address (ownAccounts). Use it to identify the counterparty of a crypto transaction: pass the exact address (EVM case does not matter) and optionally the network; without address it lists all wallets.',
    kind: 'read',
    service: findWallets,
  }),
  tool({
    name: 'list_payees',
    title: 'Payees',
    description:
      "Legal recipients of payouts: id, kind (fop|crypto|other), name, taxId, iban, payout wallet (walletAddress, walletNetwork) and the linked person (personId, personName). A person may be paid through someone else's FOP.",
    kind: 'read',
    service: listPayees,
  }),
  tool({
    name: 'upsert_person_profile',
    title: 'Create or update people',
    description:
      'Bench profiles in bulk (max 200). Matched by id, else by fullName (case-insensitive); only the fields sent are changed, a missing person is created (fullName required). Renaming needs the id. Payees, contracts and pay terms are not editable here. All-or-nothing; errors keyed "people.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertPeople,
  }),
  tool({
    name: 'upsert_clients',
    title: 'Create or update clients',
    description:
      'Clients in bulk (max 100). Matched by id, else by legalName (case-insensitive); only the fields sent are changed, a missing client is created (legalName required). contacts is an array of {name, role?, email?, phone?} and replaces the stored list when sent. Contracts and billing terms are not editable here. All-or-nothing; errors keyed "clients.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertClients,
  }),
  tool({
    name: 'upsert_wallets',
    title: 'Add or update crypto wallets',
    description:
      'Crypto wallets of people or clients in bulk (max 200). Each item names exactly one owner (personId or clientId), a network (ETH, BSC, POLYGON, ARBITRUM, BASE, OPTIMISM, AVALANCHE, TRON, SOLANA, BTC, TON) and the address, validated for that network. A new address is added; a known address of the same owner gets the label/isActive sent. An address owned by someone else or by one of our accounts is an error. Wallets are never deleted: set isActive false. All-or-nothing; errors keyed "wallets.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertWallets,
  }),
  tool({
    name: 'upsert_payees',
    title: 'Create, update or link payees',
    description:
      'Payees in bulk (max 100). Matched by id, else by taxId; only the fields sent change, a missing payee is created (kind defaults to fop; a name in Ukrainian or English is required; crypto needs walletAddress). personId links the payee to a person (null unlinks); makeDefault also makes it that person\'s default payee for new payouts. IBAN and tax id formats are checked. All-or-nothing; errors keyed "payees.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertPayees,
  }),
  tool({
    name: 'upsert_accounts',
    title: 'Create or update accounts',
    description:
      'Creates accounts or updates them by exact name (max 100). Crypto accounts take a network from the fixed list and our wallet address on it. The currency of an account that already has postings cannot change. All-or-nothing; use dryRun to preview.',
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
    name: 'update_transactions',
    title: 'Correct transactions',
    description:
      'Edits up to 100 transactions by id; only the fields sent change. Legs (from/to/fee) take {account, amount} with a positive amount, or null to remove the leg; the postings are rewritten. personId/clientId link the party (null unlinks). If money (type, accounts, amounts) of an allocated transaction changes, a reason is required and the allocations must still fit. All-or-nothing; errors keyed "transactions.<index>"; use dryRun first.',
    kind: 'write',
    service: updateTransactions,
  }),
  tool({
    name: 'add_transactions',
    title: 'Add transactions',
    description:
      'Books up to 500 transactions. Amounts are positive decimal strings in the account currency; the leg gives the sign: revenue → to, expense → from, transfer/fx_exchange/crypto_* → from + to, adjustment → exactly one of from/to; fee is optional and always booked negative. Items whose externalRef already exists are skipped as "duplicate", so a batch can be re-sent. Any invalid item rolls back the whole batch and errors are keyed "transactions.<index>". Use dryRun first.',
    kind: 'write',
    service: addTransactions,
  }),
  tool({
    name: 'delete_transactions',
    title: 'Delete transactions',
    description:
      'Permanently deletes up to 500 transactions by id together with their postings; balances change accordingly. A transaction allocated to an invoice or payout is refused. All-or-nothing; errors keyed "ids.<index>". Only on the owner\'s explicit request; always run dryRun first and show the owner what will be deleted.',
    kind: 'write',
    destructive: true,
    service: deleteTransactions,
  }),
  tool({
    name: 'list_trips',
    title: 'Business trips',
    description:
      'Trips with dates, participants, the derived status (planned, in_progress, awaiting_reimbursement, settled) and, per participant, what is left to reimburse in UAH.',
    kind: 'read',
    service: listTrips,
    present: (rows) =>
      rows.map((r) => ({
        id: r.trip.id,
        title: r.trip.title,
        location: r.trip.location,
        startsOn: r.trip.startsOn,
        endsOn: r.trip.endsOn,
        status: r.status,
        participants: r.participants.map((p) => {
          const s = r.summary.find((x) => x.personId === p.personId);
          return { personId: p.personId, name: p.name, remainingUah: s?.remainingUah ?? '0.00' };
        }),
      })),
  }),
  tool({
    name: 'get_trip',
    title: 'Trip with expenses',
    description:
      'One trip: participants, expenses (date, amount, currency, UAH rate, UAH and USD values, who paid, reimbursable, Ledger transactionId), reimbursements with what is paid, and the per-participant summary.',
    kind: 'read',
    service: getTrip,
    present: (card) => ({
      trip: card.trip,
      status: card.status,
      participants: card.participants.map((p) => ({ personId: p.personId, name: p.name })),
      expenses: card.expenses.map(({ expense: e }) => ({
        id: e.id,
        personId: e.personId,
        spentOn: e.spentOn,
        description: e.description,
        amount: e.amount,
        currency: e.currency,
        fxRate: e.fxRate,
        amountUah: e.amountUah,
        amountUsd: e.amountUsd,
        paidBy: e.paidBy,
        reimbursable: e.reimbursable,
        transactionId: e.transactionId,
        hasReceipt: e.receiptDocumentId !== null,
      })),
      reimbursements: card.reimbursements.map((r) => ({
        id: r.id,
        personId: r.personId,
        amount: r.amount,
        method: r.method,
        paidUah: r.paidUah,
        paid: r.paid,
      })),
      summary: card.summary,
    }),
  }),
  tool({
    name: 'upsert_trips',
    title: 'Create or update trips',
    description:
      'Trips in bulk (max 20): without id a trip is created, with id it is updated. Dates YYYY-MM-DD are required. participantIds (from search_people) are added to the trip and never removed here. All-or-nothing; errors keyed "trips.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertTrips,
  }),
  tool({
    name: 'add_trip_expenses',
    title: 'Add trip expenses',
    description:
      'Adds up to 200 expenses to one trip. Amount is a positive decimal string in the expense currency; fxRate (UAH per unit) defaults to the NBU rate on spentOn. paidBy person + reimbursable true = the company owes it back; paidBy company needs transactionId of the Ledger expense that paid it and is never reimbursed. The same date + amount + description already in another trip is refused unless allowDuplicate. Receipts are attached in the UI. All-or-nothing; errors keyed "expenses.<index>"; use dryRun first.',
    kind: 'write',
    service: addTripExpenses,
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
