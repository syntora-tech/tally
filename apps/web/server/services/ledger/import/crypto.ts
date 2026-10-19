import { account } from '@tally/db/schema';
import {
  DUST_LIMIT,
  feeAmount,
  fromBaseUnits,
  GAS_COINS,
  isCryptoNetwork,
  localDateInZone,
  toDecimal,
  tokenContract,
  TOKEN_CONTRACTS,
  type CryptoNetwork,
  type LocalDate,
} from '@tally/domain';
import { and, eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import type { ChainTransfer } from '../../../chain';
import { claudeForUser } from '../../ai';
import { inActorScope } from '../../context';
import { defineService } from '../../define-service';
import { msg, serviceError } from '../../errors';
import { optionalLocalDate } from '../../fields';
import { suggestWithClaude } from './ai';
import { checkAgainstLedger, insertDraft, sortRows, suggestFromLedger } from './prepare';
import { MAX_IMPORT_ROWS, type ImportRow } from './rows';

type CryptoAccount = {
  id: string;
  name: string;
  currency: string;
  network: CryptoNetwork;
  address: string | null;
  openingDate: string;
};

/** Our wallets on supported networks: token accounts with their address and the gas account. */
export function walletPlan(accounts: readonly CryptoAccount[]) {
  const plan: {
    account: CryptoAccount;
    address: string;
    contract: string;
    decimals: number;
    gas: CryptoAccount | null;
  }[] = [];
  const warnings: string[] = [];
  for (const a of accounts) {
    const token = TOKEN_CONTRACTS[a.network]?.find((t) => t.symbol === a.currency);
    if (!token) continue;
    const sameNetwork = accounts.filter((o) => o.network === a.network);
    // The wallet's address sits on its main token account (one address per network+account);
    // another account of the same token without one would book the same transfers twice.
    if (!a.address && sameNetwork.some((o) => o.address && o.currency === a.currency)) continue;
    const addresses = [...new Set(sameNetwork.flatMap((o) => (o.address ? [o.address] : [])))];
    const address = a.address ?? (addresses.length === 1 ? addresses[0] : undefined);
    if (!address) {
      warnings.push(msg('import.noWalletAddress', { account: a.name }));
      continue;
    }
    const gasCoin = GAS_COINS[a.network]?.symbol;
    const gasCandidates = sameNetwork.filter(
      (o) => o.currency === gasCoin && (!o.address || o.address === address),
    );
    plan.push({
      account: a,
      address,
      contract: token.contract,
      decimals: token.decimals,
      gas: gasCandidates.length === 1 ? (gasCandidates[0] ?? null) : null,
    });
  }
  return { plan, warnings };
}

const sameAddress = (network: CryptoNetwork, a: string, b: string) =>
  network === 'TRON' ? a === b : a.toLowerCase() === b.toLowerCase();

/**
 * Reads our USDT/USDC transfers from the chain into a draft import (A-122) and lets Claude, with
 * the user's own key, propose type, category and party. Amounts, dates, hashes and gas come
 * from the explorer only; nothing is booked until the person confirms the preview. Without a
 * personal key the feature is off.
 */
export const prepareCryptoImport = defineService({
  name: 'ledger.import.prepareCrypto',
  input: z.object({ from: optionalLocalDate }),
  handler: async (ctx, input) => {
    const chain = ctx.config.integrations?.chain;
    if (!chain) return err(serviceError('internal_error', 'import.chainUnavailable'));
    const setup = await inActorScope(ctx, async (tx) => {
      const claude = await claudeForUser(ctx, tx);
      const accounts = await tx
        .select({
          id: account.id,
          name: account.name,
          currency: account.currency,
          network: account.network,
          address: account.address,
          openingDate: account.openingDate,
        })
        .from(account)
        .where(and(eq(account.kind, 'crypto'), eq(account.isActive, true)));
      return { claude, accounts };
    });
    if (setup.claude.isErr()) return err(setup.claude.error);
    const accounts = setup.accounts.flatMap((a) =>
      a.network && isCryptoNetwork(a.network) ? [{ ...a, network: a.network }] : [],
    );
    const { plan, warnings } = walletPlan(accounts);
    if (!plan.length) return err(serviceError('validation_error', 'import.noCryptoAccounts'));

    const rows: ImportRow[] = [];
    const sources: unknown[] = [];
    const ours = new Set(plan.map((p) => `${p.account.network}:${p.address.toLowerCase()}`));
    const feeCache = new Map<string, { payer: string; fee: string } | null>();
    for (const p of plan) {
      const opening = p.account.openingDate as LocalDate;
      const since = input.from && input.from > opening ? input.from : opening;
      // One day earlier covers the Kyiv offset; rows are then cut by their Kyiv date.
      const fetched = await chain.tokenTransfers({
        network: p.account.network,
        address: p.address,
        contract: p.contract,
        since: new Date(Date.parse(`${since}T00:00:00Z`) - 86_400_000),
      });
      if (fetched.isErr()) {
        return err(
          serviceError('internal_error', msg('import.chainFailed', { account: p.account.name })),
        );
      }
      if (fetched.value.truncated)
        warnings.push(msg('import.chainTruncated', { account: p.account.name }));
      let count = 0;
      for (const t of fetched.value.transfers) {
        const row = await toRow(p, t, since, ours, async (hash) => {
          if (!feeCache.has(hash)) {
            const fee = await chain.transactionFee({ network: p.account.network, hash });
            feeCache.set(hash, fee.isOk() ? fee.value : null);
          }
          return feeCache.get(hash) ?? null;
        });
        if (row === 'skip') continue;
        if (row === 'fee_unknown') {
          return err(
            serviceError('internal_error', msg('import.chainFailed', { account: p.account.name })),
          );
        }
        rows.push(row);
        count++;
      }
      sources.push({
        accountId: p.account.id,
        network: p.account.network,
        address: p.address,
        from: since,
        rows: count,
      });
    }
    // Several transfers of one account in one transaction (batch payouts) keep distinct refs.
    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.accountId}:${r.externalRef}`;
      if (seen.has(key)) r.externalRef = `${r.externalRef}:${r.key.split(':').at(-1) ?? ''}`;
      seen.add(key);
    }
    // A transfer between two of our wallets is read from both sides: one transfer, two legs.
    for (const r of rows) {
      if (r.direction !== 'in') continue;
      const out = rows.find(
        (o) =>
          o.direction === 'out' &&
          o.ref === r.ref &&
          o.network === r.network &&
          o.accountId !== r.accountId,
      );
      if (out) r.attachTo = out.key;
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      return err(
        serviceError(
          'validation_error',
          msg('import.tooManyRows', { max: String(MAX_IMPORT_ROWS) }),
        ),
      );
    }

    const id = await inActorScope(ctx, async (tx) => {
      await checkAgainstLedger(tx, rows);
      await suggestFromLedger(tx, rows);
      return insertDraft(tx, 'crypto', sources, sortRows(rows), { warnings });
    });
    // The draft is kept even if Claude fails: the person can retry or fill the rows by hand.
    const suggested = rows.some((r) => r.status === 'new' || r.status === 'match')
      ? await suggestWithClaude(ctx, setup.claude.value, { importId: id, scope: 'missing' })
      : ok({ suggested: 0 });
    return ok({ id, aiError: suggested.isErr() ? suggested.error.message : null });
  },
});

type PlanItem = ReturnType<typeof walletPlan>['plan'][number];

async function toRow(
  p: PlanItem,
  t: ChainTransfer,
  since: LocalDate,
  ours: Set<string>,
  feeOf: (hash: string) => Promise<{ payer: string; fee: string } | null>,
): Promise<ImportRow | 'skip' | 'fee_unknown'> {
  const network = p.account.network;
  // Explorers filter by contract too; this check keeps look-alike tokens out regardless.
  if (!tokenContract(network, t.contract) || t.contract.toLowerCase() !== p.contract.toLowerCase())
    return 'skip';
  const amount = fromBaseUnits(t.value, p.decimals);
  if (!amount || toDecimal(amount).isZero()) return 'skip';
  const occurredOn = localDateInZone(t.at);
  if (occurredOn < since) return 'skip';
  const outgoing = sameAddress(network, t.from, p.address);
  const incoming = sameAddress(network, t.to, p.address);
  if (outgoing === incoming) return 'skip';
  const counterparty = outgoing ? t.to : t.from;
  const hash = network === 'TRON' ? t.hash : t.hash.toLowerCase();
  let fee: ImportRow['fee'] = null;
  const flags: string[] = [];
  if (outgoing) {
    const paid = await feeOf(t.hash);
    if (!paid) return 'fee_unknown';
    const gas = GAS_COINS[network];
    const value =
      gas && sameAddress(network, paid.payer, p.address)
        ? fromBaseUnits(paid.fee, gas.decimals)
        : null;
    const rounded = value ? feeAmount(value) : null;
    if (rounded && p.gas) fee = { accountId: p.gas.id, amount: rounded };
    else if (rounded) flags.push('no_gas_account');
  }
  const ownCounterparty = ours.has(`${network}:${counterparty.toLowerCase()}`);
  if (!outgoing && !ownCounterparty && toDecimal(amount).lt(DUST_LIMIT)) flags.push('dust');
  return {
    key: `${p.account.id.slice(0, 8)}:${hash}:${String(t.logIndex)}`,
    accountId: p.account.id,
    occurredOn,
    direction: outgoing ? 'out' : 'in',
    amount,
    currency: p.account.currency,
    externalRef: hash,
    ref: hash,
    docNumber: null,
    purpose: null,
    counterparty: null,
    counterpartyTaxId: null,
    counterpartyAccount: null,
    ourAccount: p.address,
    counterpartyAddress: counterparty,
    network,
    fee,
    source: { file: null, line: null },
    status: 'new',
    existingId: null,
    attachTo: null,
    flags,
    suggestion: null,
  };
}
