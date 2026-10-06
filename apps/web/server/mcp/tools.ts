import type { McpProfile } from '@tally/db/schema';
import type { z } from 'zod';
import type { DocumentStorage } from '../storage/types';
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
import {
  documentAgentServices,
  findLinkTargets,
  linkDocuments,
  unlinkDocuments,
  updateDocuments,
} from '../services/documents/agent';
import { searchDocuments } from '../services/documents/registry';
import {
  currentTerms,
  listAssignments,
  upsertAssignments,
  type AgentAssignmentRow,
} from '../services/assignments/agent';
import { getContractCard, listContracts, type ContractRow } from '../services/contracts';
import { listContractAnnexes, type AnnexRow } from '../services/contracts/annexes';
import { upsertContractAnnexes, upsertContracts } from '../services/contracts/batch';
import { getTrip, listTrips } from '../services/trips';
import { tripBatchServices, upsertTrips } from '../services/trips/batch';
import { findWallets, upsertWallets } from '../services/wallets';
import { listPersonCharges, listPlannedExpenses } from '../services/planned';
import {
  updatePlannedPayments,
  upsertPayoutCharges,
  upsertPlannedExpenses,
} from '../services/planned/agent';
import { listPlannedPayments } from '../services/planned/payments';

export type ToolKind = 'read' | 'write';

/** What a tool may need beyond the service context; document tools take the file storage. */
export type ToolDeps = { storage: () => DocumentStorage };

export type ToolDef = {
  name: string;
  title: string;
  description: string;
  kind: ToolKind;
  /** Write tools that remove data are announced as destructive to MCP clients. */
  destructive?: boolean;
  input: z.ZodType;
  run: (ctx: ServiceContext, rawInput: unknown, deps: ToolDeps) => Promise<ServiceResult<unknown>>;
  /** Shapes the service result for agents; defaults to the raw value. */
  present: (value: unknown) => unknown;
};

const NO_DEPS: ToolDeps = {
  storage: () => {
    throw new Error('No document storage in this context');
  },
};

/** Keeps each tool's `present` typed against its own service result. */
function tool<S extends z.ZodType, T>(
  def: Pick<ToolDef, 'name' | 'title' | 'description' | 'kind' | 'destructive'> & {
    service: Service<S, T> | ((deps: ToolDeps) => Service<S, T>);
    present?: (value: T) => unknown;
  },
): ToolDef {
  const { service, present, ...meta } = def;
  const build = typeof service === 'function' ? service : () => service;
  return {
    ...meta,
    input: build(NO_DEPS).input,
    run: (ctx, raw, deps) => build(deps).run(ctx, raw),
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

function contractSummary(r: ContractRow) {
  const c = r.contract;
  return {
    id: c.id,
    kind: c.kind,
    number: c.number,
    signedOn: c.signedOn,
    clientId: c.clientId,
    clientName: r.clientName,
    payeeId: c.payeeId,
    payeeName: r.payeeName,
    currency: c.currency,
    status: c.status,
    paymentDueRule: c.paymentDueRule,
    invoiceDateRule: c.invoiceDateRule,
    actDateRule: c.actDateRule,
    numberSequenceKey: c.numberSequenceKey,
    annexes: r.annexes,
    assignments: r.assignments,
    documents: r.documents,
  };
}

const billingView = (b: AgentAssignmentRow['billing'][number]) => ({
  validFrom: b.validFrom,
  type: b.type,
  rate: b.rate,
  currency: b.currency,
  prorationPolicy: b.prorationPolicy,
  invoiceChannel: b.invoiceChannel,
});
const payView = (p: AgentAssignmentRow['pay'][number]) => ({
  validFrom: p.validFrom,
  type: p.type,
  amount: p.amount,
  currency: p.currency,
  payoutMethod: p.payoutMethod,
  releasePolicy: p.releasePolicy,
  graceDays: p.graceDays,
});

function assignmentSummary(r: AgentAssignmentRow) {
  const a = r.assignment;
  const now = currentTerms(r);
  return {
    id: a.id,
    personId: a.personId,
    personName: r.personName,
    isInternal: a.isInternal,
    contractId: a.contractId,
    contractNumber: r.contractNumber,
    clientId: r.clientId,
    clientName: r.clientName,
    annexId: a.annexId,
    annex: a.annexId ? `${(r.annexKind ?? '').toUpperCase()} ${r.annexNumber ?? ''}` : null,
    sowRef: a.sowRef,
    roleTitle: a.roleTitle,
    fte: a.fte,
    startsOn: a.startsOn,
    endsOn: a.endsOn,
    termsMonth: r.month,
    billing: now.billing && billingView(now.billing),
    pay: now.pay && payView(now.pay),
    agencyRatePerHour: now.agency?.ratePerHour ?? null,
    billingVersions: r.billing.map(billingView),
    payVersions: r.pay.map(payView),
  };
}

function annexSummary(r: AnnexRow) {
  const a = r.annex;
  return {
    id: a.id,
    contractId: a.contractId,
    contractNumber: r.contractNumber,
    clientId: r.clientId,
    clientName: r.clientName,
    kind: a.kind,
    number: a.number,
    title: a.title,
    signedOn: a.signedOn,
    validFrom: a.validFrom,
    validTo: a.validTo,
    status: a.status,
    paymentDueRule: a.paymentDueRule,
    invoiceDateRule: a.invoiceDateRule,
    notes: a.notes,
    assignments: r.assignments,
    documents: r.documents,
  };
}

/**
 * Tools v1 for the Ledger, people and clients (spec 13.3, narrowed and written directly per
 * A-054, A-056). Payouts, allocations, issuing documents and deletions other
 * than unallocated transactions are deliberately absent from MCP (13.3 «не виставляються»);
 * payees are allowed since A-062, deleting transactions since A-063, the document registry and
 * its links since A-071, deleting documents and contracts with their SOWs/annexes since A-072,
 * assignments with their terms since A-073, planned payments with their taxes and marking them
 * paid since A-082.
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
      'Clients with legal and short name, country, default currency, the number of contracts (see list_contracts) and crypto wallets (network, address, label, isActive).',
    kind: 'read',
    service: listClients,
  }),
  tool({
    name: 'list_contracts',
    title: 'Contracts',
    description:
      'Client and FOP contracts with the counterparty, currency, status, date rules (paymentDueRule: day_of_month {day} | net_days {days} | net_working_days {days}; invoiceDateRule; actDateRule), counts of SOWs/annexes and assignments, and the linked documents. Filters: clientId, payeeId, kind client|fop, status active|ended, q (number or counterparty name).',
    kind: 'read',
    service: listContracts,
    present: (rows) => rows.map(contractSummary),
  }),
  tool({
    name: 'get_contract',
    title: 'Contract card',
    description:
      'One contract: requisites, date rules, linked documents, its SOWs/annexes (each with its own date rules, documents and assignment count) and the assignments of people (personId, role, annexId, fte, startsOn, endsOn).',
    kind: 'read',
    service: getContractCard,
    present: (card) => ({
      ...contractSummary(card),
      annexes: card.annexList.map(annexSummary),
      assignments: card.assignmentList,
    }),
  }),
  tool({
    name: 'list_contract_annexes',
    title: 'SOWs and annexes',
    description:
      "SOWs/annexes inside contracts: id, contract, kind sow|annex, number, title, signedOn, validFrom/validTo, status draft|active|ended, their own date rules (null = the contract's), documents and assignment count. Filters: contractId, clientId, status.",
    kind: 'read',
    service: listContractAnnexes,
    present: (rows) => rows.map(annexSummary),
  }),
  tool({
    name: 'list_assignments',
    title: 'Assignments of people',
    description:
      'People on contracts: person, contract, client, SOW/annex (annexId), role, fte, startsOn/endsOn, the terms in force in the month of activeOn (or today) — billing (what the client pays: type hourly|fixed_monthly|none, rate, currency, prorationPolicy, invoiceChannel) and pay (what the person gets: type fixed|hourly|hourly_rate|included, amount, currency, payoutMethod, releasePolicy, graceDays) — and every version of both. Filters: personId, contractId, annexId, clientId, activeOn (YYYY-MM-DD: only assignments running that day).',
    kind: 'read',
    service: listAssignments,
    present: (rows) => rows.map(assignmentSummary),
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
      'Clients in bulk (max 100). Matched by id, else by legalName (case-insensitive); only the fields sent are changed, a missing client is created (legalName required). contacts is an array of {name, role?, email?, phone?} and replaces the stored list when sent. Contracts are written with upsert_contracts; billing terms are not editable here. All-or-nothing; errors keyed "clients.<index>"; use dryRun first.',
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
    name: 'upsert_contracts',
    title: 'Create or update contracts',
    description:
      'Contracts in bulk (max 50). kind client needs clientId, kind fop needs payeeId (exactly one). Matched by id, else by number (case-insensitive) plus the clientId/payeeId sent; only the fields sent change, a missing contract is created (kind, number and the counterparty required). Fields: number, signedOn, currency, status active|ended, paymentDueRule {type: day_of_month, day} | {type: net_days, days} | {type: net_working_days, days} (working days after the invoice date, e.g. 15 for IdeaSoft), invoiceDateRule {type: first_working_day_after_period} | {type: nth_working_day_after_period, n}, actDateRule (also manual), numberSequenceKey. documentIds links documents already in the registry (no re-upload). All-or-nothing; errors keyed "contracts.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertContracts,
  }),
  tool({
    name: 'upsert_contract_annexes',
    title: 'Create or update SOWs and annexes',
    description:
      'SOWs/annexes inside contracts in bulk (max 100). Matched by id, else by contractId + kind + number; only the fields sent change, a missing one is created (contractId, kind sow|annex and number required). Fields: title, signedOn, validFrom, validTo, status draft|active|ended (default active), notes, paymentDueRule and invoiceDateRule (same shapes as upsert_contracts) to replace the contract\'s rules for this SOW — its assignments then get an invoice of their own; null returns to the contract\'s rules. documentIds links documents already in the registry. Each result has the id to use for assignments. All-or-nothing; errors keyed "annexes.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertContractAnnexes,
  }),
  tool({
    name: 'upsert_assignments',
    title: 'Create or update assignments',
    description:
      'Assignments in bulk (max 100). Matched by id, else by personId + contractId + annexId + startsOn. A new one needs personId, startsOn, contractId of a client contract (or isInternal true with no contract) and both billing and pay. Optional: annexId (a SOW of the same contract), roleTitle, fte ("0.5", default "1"), endsOn, sowRef. billing {type hourly|fixed_monthly|none, rate, currency, prorationPolicy full_month|by_hours|trunc_hourly, invoiceChannel fiat|crypto, validFrom?}; pay {type fixed (monthly) | hourly (monthly amount spread over the norm: amount / H × hours) | hourly_rate (amount per hour × the hours paid to the person) | included, amount (fixed already includes FTE), currency, payoutMethod fiat|crypto, releasePolicy on_payment_or_due|immediate, graceDays, validFrom?}. Amounts are decimal strings. Without validFrom a version starts in the start month, or the first open month if that one is closed. To change terms send billing/pay with validFrom (first day of a later month, after the last closed period): a new version is added; a version repeating the stored one is "existing", the same month with other values is an error — versions are never edited. Person, contract and isInternal cannot change. All-or-nothing; errors keyed "assignments.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertAssignments,
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
      'Adds up to 200 expenses to one trip. Amount is a positive decimal string in the expense currency; fxRate (UAH per unit) defaults to the NBU rate on spentOn. paidBy person + reimbursable true = the company owes it back; paidBy company needs transactionId of the Ledger expense that paid it and is never reimbursed. The same date + amount + description already in another trip is refused unless allowDuplicate. receipt {fileName, mimeType, contentBase64} attaches the receipt photo/PDF (all receipts of a call up to 3 MB). All-or-nothing; errors keyed "expenses.<index>"; use dryRun first.',
    kind: 'write',
    service: (deps: ToolDeps) => tripBatchServices(deps.storage).addTripExpenses,
  }),
  tool({
    name: 'search_documents',
    title: 'Document registry',
    description:
      'Documents (contracts, SOWs, annexes, invoices = ours to clients, bills = issued to us, acts, CVs, NDAs, statements, receipts, signed packages, other), newest first, each with the records it is linked to; a part of a signed package carries packageId and packagePages. Filters: q (number or title), type, status (draft|issued|void; issued = active), historical (true = only history, false = only current), unlinked true for documents attached to nothing, linkedTo {entityType, entityId} for the documents of one record, limit (max 500).',
    kind: 'read',
    service: searchDocuments,
    present: (rows) =>
      rows.map(({ links, ...d }) => ({
        ...d,
        links: links.map(({ entityType, entityId, label }) => ({ entityType, entityId, label })),
      })),
  }),
  tool({
    name: 'get_document',
    title: 'Document card',
    description:
      'One document: metadata, its signed package (package) or its parts (parts), file name/type/size, viewUrl (Drive), linked records, and its version chain (isLatestVersion). includeContent true also returns the file as content {contentBase64, mimeType} for files up to 3 MB; otherwise contentOmitted says why (no_file, too_large, unavailable).',
    kind: 'read',
    service: (deps: ToolDeps) => documentAgentServices(deps.storage).getDocumentForAgent,
  }),
  tool({
    name: 'find_link_targets',
    title: 'Find records to link',
    description:
      'Records a document can be attached to, by entityType (person, payee, client, contract, contract_annex, assignment, invoice, supplier_act, trip, transaction) and optional text q (name, number, title, description); returns {id, label}. Use the id in add_documents.links or link_documents.',
    kind: 'read',
    service: findLinkTargets,
  }),
  tool({
    name: 'add_documents',
    title: 'Add documents',
    description:
      'Adds up to 10 documents to the registry. Each has a type, title, optional number/docDate/notes, and a file {fileName, mimeType, contentBase64} (max 3 MB decoded, also for all files of one call together) or a url (stored as a link, never fetched), plus links [{entityType, entityId}]; the first link picks the Drive folder. supersedesId makes it the next version of a document of the same type. Links to missing records are errors. All-or-nothing; errors keyed "documents.<index>"; dryRun previews the folder and links without uploading.',
    kind: 'write',
    service: (deps: ToolDeps) => documentAgentServices(deps.storage).addDocuments,
  }),
  tool({
    name: 'update_documents',
    title: 'Correct documents',
    description:
      'Edits up to 100 documents by id; only the fields sent change (type, title, number, docDate, url, notes, status, historical; null clears an optional field). historical true marks a document kept for history (before Tally): it never shows in the inbox or checks. Types: invoice = ours to a client, bill = an invoice issued to us by a contractor or supplier; package only comes from split_document. To cancel a document set status void; a document uploaded by mistake is removed with delete_documents. Files Tally generated or signed copies of invoices/acts are read-only here. All-or-nothing; errors keyed "documents.<index>"; use dryRun first.',
    kind: 'write',
    service: updateDocuments,
  }),
  tool({
    name: 'split_document',
    title: 'Split a signed package',
    description:
      'Cuts one signed PDF that holds several documents (e.g. MSA + SOW, agreement + annex + invoice) into its parts by pages. The e-signature covers the whole file, so the original stays as a document of type package with its file, signature and links; each part becomes its own document (type, title, number, docDate, pages like "1-10", links) with a copy of its pages and a link back to the package. Parts default to the package date and its person/client/payee links. A package can get more parts later. Run dryRun first to check the page count and folders.',
    kind: 'write',
    service: (deps: ToolDeps) => documentAgentServices(deps.storage).splitDocument,
  }),
  tool({
    name: 'delete_documents',
    title: 'Delete documents',
    description:
      'Permanently deletes up to 200 documents uploaded by mistake, by id, with all their links; a newer version of a deleted document moves to the nearest surviving predecessor. The file goes to the Drive trash (restorable there for 30 days) unless another document uses it (file kept_shared); file trash_failed means the row is gone but the file must be trashed by hand. Files Tally generated and signed copies of invoices/acts are refused. All-or-nothing; errors keyed "ids.<index>". Only on the owner\'s explicit request; always run dryRun first and show the owner what will be deleted.',
    kind: 'write',
    destructive: true,
    service: (deps: ToolDeps) => documentAgentServices(deps.storage).deleteDocuments,
  }),
  tool({
    name: 'link_documents',
    title: 'Link documents to records',
    description:
      'Attaches documents to records, up to 200 {documentId, entityType, entityId}; entityType contract_annex attaches to a SOW/annex. An existing link is reported as "existing". The record must exist (find it with find_link_targets). All-or-nothing; errors keyed "links.<index>"; use dryRun first.',
    kind: 'write',
    service: linkDocuments,
  }),
  tool({
    name: 'unlink_documents',
    title: 'Unlink documents from records',
    description:
      'Removes up to 200 links {documentId, entityType, entityId}; the documents themselves stay. A link that is not there is reported as "missing". The invoice/act link of a file Tally generated or a signed copy cannot be removed. Only on the owner\'s request; run dryRun first. All-or-nothing; errors keyed "links.<index>".',
    kind: 'write',
    destructive: true,
    service: unlinkDocuments,
  }),
  tool({
    name: 'list_planned_expenses',
    title: 'Planned expenses',
    description:
      'Recurring company costs (accountant, director salary, bank service, subscriptions) with their parts within the month (e.g. advance by the 22nd, the rest by the 7th of the next month), taxes (withheld from the gross or on top), bank fee tariff (fixed + %) and next date. Each month they become planned payments (list_planned_payments).',
    kind: 'read',
    service: listPlannedExpenses,
    present: (rows) =>
      rows.map((r) => ({
        ...r.expense,
        categoryName: r.categoryName,
        personName: r.personName,
        nextOn: r.nextOn,
        parts: r.parts.map((p) => ({
          id: p.id,
          name: p.name,
          amount: p.amount,
          dueDay: p.dueDay,
          monthOffset: p.monthOffset,
        })),
        charges: r.charges.map((c) => ({ ...c.charge, categoryName: c.categoryName })),
      })),
  }),
  tool({
    name: 'list_payout_charges',
    title: 'Taxes on payouts to people',
    description:
      'Taxes charged on every payout to a person (on top, e.g. 20 % in UAH at the NBU rate of the payout day). Filter by personIds. Each payout then gets a planned payment for the tax.',
    kind: 'read',
    service: listPersonCharges,
    present: (rows) =>
      rows.map((r) => ({ ...r.charge, categoryName: r.categoryName, personName: r.personName })),
  }),
  tool({
    name: 'list_planned_payments',
    title: 'Planned payments to make',
    description:
      'Payments of planned expenses and taxes on payouts, by due date (from/to YYYY-MM-DD, default last month to the end of the next one; status due|paid|skipped). A charge has parentId = its instalment, or sourceAllocationId = the payout it taxes. gross is the base of the charges; amount is what to pay; feeAmount/feeCurrency the expected bank fee; overdue = due before today. transactions lists the Ledger expenses that paid it.',
    kind: 'read',
    service: listPlannedPayments,
    present: (rows) =>
      rows.map((r) => ({
        ...r.payment,
        categoryName: r.categoryName,
        personName: r.personName,
        overdue: r.overdue,
        transactions: r.transactions.map((t) => ({
          id: t.transactionId,
          occurredOn: t.occurredOn,
          amount: t.amount,
          currency: t.currency,
        })),
      })),
  }),
  tool({
    name: 'upsert_planned_expenses',
    title: 'Create or update planned expenses',
    description:
      'Planned expenses in bulk (max 50), matched by id; only the fields sent change. A new one needs name, categoryId, amount, currency, startsOn (YYYY-MM). frequency monthly|quarterly|yearly (+ anchorMonth), dueDay, endsOn (stop a plan with it), personId (whose cost), counterparty, fee tariff (feeFixed, feePercent, feeCurrency). parts replaces the instalments when sent: [{name, amount (null = the rest), dueDay, monthOffset 0|1}]. charges replaces its taxes when sent: [{name, mode withheld|on_top, ratePercent, categoryId, currency?, counterparty?, startsOn, endsOn?, fee…}]; keep ids of existing ones. Director salary example: amount = monthly gross, parts Advance 5500 day 22 + Rest (null) day 7 monthOffset 1, charges PIT 18 withheld, military levy 5 withheld, ESV 22 on_top, each fee 5 UAH. Unpaid payments of this month on follow the change. All-or-nothing; errors keyed "items.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertPlannedExpenses,
  }),
  tool({
    name: 'upsert_payout_charges',
    title: 'Set taxes on payouts to a person',
    description:
      'Taxes on every payout to a person (max 50), always on top of the payout, matched by id. A new one needs personId, name, ratePercent, categoryId (Taxes), startsOn (YYYY-MM); currency (e.g. UAH: converted at the NBU rate of the payout day), counterparty, endsOn (stop it), fee tariff. Each later payout creates a planned payment for it. All-or-nothing; errors keyed "charges.<index>"; use dryRun first.',
    kind: 'write',
    service: upsertPayoutCharges,
  }),
  tool({
    name: 'update_planned_payments',
    title: 'Mark planned payments paid, skipped or corrected',
    description:
      'Up to 100 actions on planned payments (ids from list_planned_payments): pay {transactionIds of expenses already in the Ledger, e.g. statement rows in the same currency; their unlinked money is linked} or {accountId, occurredOn, amount?, feeAmount?, feeAccountId?} to book a new expense; unlink {transactionIds?}; skip {reason} (an instalment skips its unpaid taxes too); unskip; set_amount {amount: for a salary instalment the gross — net and taxes follow — else the amount}; reset_amount. Paid payments are fixed. All-or-nothing; errors keyed "payments.<index>"; use dryRun first.',
    kind: 'write',
    service: updatePlannedPayments,
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
