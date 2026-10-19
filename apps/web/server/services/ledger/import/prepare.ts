import type { DbTransaction } from '@tally/db';
import {
  account,
  category,
  client,
  cryptoWallet,
  ledgerImport,
  payee,
  posting,
  transaction,
} from '@tally/db/schema';
import { addDays, normalizeText, ruleCategory, toDecimal, type LocalDate } from '@tally/domain';
import { and, desc, gte, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { ImportRow, Suggestion } from './rows';

type Existing = {
  id: string;
  externalRef: string | null;
  occurredOn: string;
  description: string | null;
  postings: { accountId: string; amount: string; isFee: boolean }[];
};

const lower = (s: string) => s.toLowerCase();

/**
 * Sets `status`/`existingId` of every row against the Ledger (A-121): the same reference already
 * booked (also inside the description of an exchange: `credit ref …`, `fee ref …`), or a row
 * without a reference on the same account, day and amount — booked by hand or by Pay.
 */
export async function checkAgainstLedger(tx: DbTransaction, rows: ImportRow[]): Promise<void> {
  if (!rows.length) return;
  const accounts = await tx
    .select({ id: account.id, openingDate: account.openingDate })
    .from(account)
    .where(inArray(account.id, [...new Set(rows.map((r) => r.accountId))]));
  const openingOf = new Map(accounts.map((a) => [a.id, a.openingDate]));

  const refs = [...new Set(rows.map((r) => lower(r.externalRef)))];
  const byRef = await tx
    .select({
      id: transaction.id,
      externalRef: transaction.externalRef,
      legacyRef: transaction.legacyRef,
    })
    .from(transaction)
    .where(
      or(
        inArray(sql`lower(${transaction.externalRef})`, refs),
        inArray(sql`lower(${transaction.legacyRef})`, refs),
      ),
    );
  const known = new Map<string, string>();
  for (const r of byRef) {
    if (r.externalRef) known.set(lower(r.externalRef), r.id);
    if (r.legacyRef) known.set(lower(r.legacyRef), r.id);
  }

  const dates = rows.map((r) => r.occurredOn).sort();
  const from = addDays((dates[0] ?? '') as LocalDate, -3);
  const to = addDays((dates.at(-1) ?? '') as LocalDate, 3);
  const accountIds = [
    ...new Set([
      ...rows.map((r) => r.accountId),
      ...rows.flatMap((r) => (r.fee ? [r.fee.accountId] : [])),
    ]),
  ];
  const nearby = await tx
    .select({
      id: transaction.id,
      externalRef: transaction.externalRef,
      occurredOn: transaction.occurredOn,
      description: transaction.description,
    })
    .from(transaction)
    .where(
      and(
        gte(transaction.occurredOn, from),
        lte(transaction.occurredOn, to),
        sql`exists (select 1 from ${posting} p where p.transaction_id = "transaction"."id" and p.account_id in ${accountIds})`,
      ),
    );
  const postings = nearby.length
    ? await tx
        .select({
          transactionId: posting.transactionId,
          accountId: posting.accountId,
          amount: posting.amount,
          isFee: posting.isFee,
        })
        .from(posting)
        .where(
          inArray(
            posting.transactionId,
            nearby.map((n) => n.id),
          ),
        )
    : [];
  const existing: Existing[] = nearby.map((n) => ({
    ...n,
    postings: postings.filter((p) => p.transactionId === n.id),
  }));
  const descriptions = existing.map((e) => ({ id: e.id, text: lower(e.description ?? '') }));

  const claimed = new Set<string>();
  for (const row of rows) {
    const opening = openingOf.get(row.accountId);
    if (opening && row.occurredOn < opening) {
      row.status = 'before_opening';
      continue;
    }
    const exact = known.get(lower(row.externalRef));
    if (exact) {
      row.status = 'duplicate';
      row.existingId = exact;
      continue;
    }
    const mentions = [row.ref, row.externalRef].flatMap((r) =>
      r && r.length >= 6 ? [lower(r)] : [],
    );
    const inDescription = descriptions.find((d) =>
      mentions.some(
        (m) => d.text.includes(`ref ${m}`) || (row.network !== null && d.text.includes(m)),
      ),
    );
    if (inDescription) {
      row.status = 'duplicate';
      row.existingId = inDescription.id;
      continue;
    }
    const signed = row.direction === 'out' ? toDecimal(row.amount).neg() : toDecimal(row.amount);
    const sameMoney = existing.filter(
      (e) =>
        !claimed.has(e.id) &&
        e.occurredOn === row.occurredOn &&
        e.postings.some(
          (p) => !p.isFee && p.accountId === row.accountId && toDecimal(p.amount).eq(signed),
        ),
    );
    const unreferenced = sameMoney.find((e) => !e.externalRef);
    const candidate = unreferenced ?? sameMoney[0];
    if (candidate) {
      claimed.add(candidate.id);
      row.status = unreferenced ? 'match' : 'possible_duplicate';
      row.existingId = candidate.id;
    }
  }

  // A fee or second leg of a row already in the Ledger is in it too when that row carries it.
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const row of rows) {
    const target = row.attachTo ? byKey.get(row.attachTo) : undefined;
    if (!target || row.status !== 'new') continue;
    if (target.status === 'new') continue;
    const booked = existing.find((e) => e.id === target.existingId);
    const signed = row.direction === 'out' ? toDecimal(row.amount).neg() : toDecimal(row.amount);
    const carried = booked?.postings.some(
      (p) => p.accountId === row.accountId && toDecimal(p.amount).eq(signed),
    );
    if (carried && booked) {
      row.status = 'duplicate';
      row.existingId = booked.id;
    }
    row.attachTo = null;
  }
}

/** Counterparty names compare without legal forms, quotes and spacing. */
export function counterpartyKey(name: string | null): string | null {
  if (!name) return null;
  const key = normalizeText(name)
    .replace(/["'«»`’]/g, '')
    .replace(/(^|\s)(фоп|тов|ат кб|ат|пп|llc|ltd|ou|oü|inc|corp)(?=\s|$|-)/g, ' ')
    .replace(/-фоп$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return key.length >= 3 ? key : null;
}

const digits = (s: string | null) => s?.replace(/\D/g, '') ?? '';

/**
 * Suggestions without AI (A-121), strongest first: the party from the payee's tax ID / IBAN or a
 * known wallet; type and category from the latest Ledger row of the same counterparty, else
 * from the built-in rules; the other leg of an exchange or own transfer makes it two-leg.
 */
export async function suggestFromLedger(tx: DbTransaction, rows: ImportRow[]): Promise<void> {
  const [payees, clients, wallets, categories, history] = await Promise.all([
    tx
      .select({ taxId: payee.taxId, iban: payee.iban, personId: payee.personId })
      .from(payee)
      .where(isNotNull(payee.personId)),
    tx
      .select({ id: client.id, legalName: client.legalName, shortName: client.shortName })
      .from(client),
    tx
      .select({
        network: cryptoWallet.network,
        address: cryptoWallet.address,
        personId: cryptoWallet.personId,
        clientId: cryptoWallet.clientId,
      })
      .from(cryptoWallet),
    tx.select({ id: category.id, name: category.name, txType: category.txType }).from(category),
    tx
      .select({
        type: transaction.type,
        categoryId: transaction.categoryId,
        counterparty: transaction.counterparty,
        counterpartyAddress: transaction.counterpartyAddress,
        personId: transaction.personId,
        clientId: transaction.clientId,
      })
      .from(transaction)
      .where(or(isNotNull(transaction.counterparty), isNotNull(transaction.counterpartyAddress)))
      .orderBy(desc(transaction.occurredOn), desc(transaction.createdAt))
      .limit(3000),
  ]);
  const categoryId = (type: string, name: string) =>
    categories.find((c) => c.txType === type && c.name === name)?.id ?? null;
  const latestBy = new Map<string, (typeof history)[number]>();
  for (const h of history) {
    const keys = [
      counterpartyKey(h.counterparty),
      h.counterpartyAddress && `addr:${lower(h.counterpartyAddress)}`,
    ];
    for (const k of keys) if (k && !latestBy.has(k)) latestBy.set(k, h);
  }
  const clientNames = clients.flatMap((c) =>
    [c.shortName, c.legalName].flatMap((n) => {
      const key = counterpartyKey(n);
      return key && key.length >= 4 ? [{ id: c.id, key }] : [];
    }),
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));

  for (const row of rows) {
    if (row.attachTo) {
      const main = byKey.get(row.attachTo);
      const isCounter = main && main.direction !== row.direction;
      const fees = categoryId('expense', 'Bank Fees');
      row.suggestion = isCounter
        ? null
        : {
            type: 'expense',
            categoryId: fees,
            personId: null,
            clientId: null,
            description: null,
            source: 'pair',
            confidence: 'medium',
            reason: null,
          };
      continue;
    }
    let personId: string | null = null;
    let clientId: string | null = null;
    let partySource: Suggestion['source'] | null = null;
    const tax = digits(row.counterpartyTaxId);
    const viaPayee = payees.find(
      (p) =>
        (tax.length >= 8 && digits(p.taxId) === tax) ||
        (row.counterpartyAccount &&
          p.iban &&
          p.iban.replace(/\s/g, '') === row.counterpartyAccount),
    );
    if (viaPayee?.personId) {
      personId = viaPayee.personId;
      partySource = 'payee';
    }
    const viaWallet = row.counterpartyAddress
      ? wallets.find(
          (w) =>
            w.network === row.network && lower(w.address) === lower(row.counterpartyAddress ?? ''),
        )
      : undefined;
    if (!partySource && viaWallet) {
      personId = viaWallet.personId;
      clientId = viaWallet.clientId;
      partySource = 'wallet';
    }

    const counter = rows.find((r) => r.attachTo === row.key && r.direction !== row.direction);
    if (counter) {
      const sameCurrency = counter.currency === row.currency;
      const type = row.network ? 'transfer' : sameCurrency ? 'transfer' : 'fx_exchange';
      row.suggestion = {
        type,
        categoryId: categoryId(type, type === 'transfer' ? 'Internal Transfer' : 'FX Exchange'),
        personId: null,
        clientId: null,
        description: null,
        source: 'pair',
        confidence: 'high',
        reason: null,
      };
      continue;
    }

    const plainType = row.direction === 'in' ? 'revenue' : 'expense';
    const past = [
      row.counterpartyAddress ? `addr:${lower(row.counterpartyAddress)}` : null,
      counterpartyKey(row.counterparty),
    ].flatMap((k) => (k && latestBy.get(k) ? [latestBy.get(k)] : []))[0];
    const pastFits = past && past.type === plainType;
    if (!partySource && pastFits && (past.personId || past.clientId)) {
      personId = past.personId;
      clientId = past.clientId;
      partySource = 'history';
    }
    if (!partySource && row.direction === 'in') {
      const text = counterpartyKey(`${row.counterparty ?? ''} ${row.purpose ?? ''}`) ?? '';
      const named = [
        ...new Set(clientNames.filter((c) => ` ${text} `.includes(` ${c.key} `)).map((c) => c.id)),
      ];
      if (named.length === 1) {
        clientId = named[0] ?? null;
        partySource = 'history';
      }
    }
    const rule = ruleCategory(row);
    const chosen: Pick<Suggestion, 'type' | 'categoryId' | 'source' | 'confidence'> | null =
      pastFits
        ? { type: past.type, categoryId: past.categoryId, source: 'history', confidence: 'high' }
        : rule && rule.type === plainType
          ? {
              type: rule.type,
              categoryId: categoryId(rule.type, rule.category),
              source: 'rule',
              confidence: 'medium',
            }
          : null;
    if (!chosen && !partySource) {
      row.suggestion = null;
      continue;
    }
    const knownParty = partySource === 'payee' || partySource === 'wallet';
    row.suggestion = {
      type: chosen?.type ?? plainType,
      categoryId: chosen?.categoryId ?? null,
      personId,
      clientId,
      description: null,
      source: chosen?.source ?? partySource ?? 'history',
      confidence: !chosen?.categoryId ? 'low' : knownParty ? 'high' : chosen.confidence,
      reason: null,
    };
  }
}

export async function insertDraft(
  tx: DbTransaction,
  kind: 'bank' | 'crypto',
  sources: unknown[],
  rows: ImportRow[],
  summary: Record<string, unknown> = {},
) {
  const [row] = await tx
    .insert(ledgerImport)
    .values({ kind, sources, rows, summary })
    .returning({ id: ledgerImport.id });
  if (!row) throw new Error('ledger_import insert returned no row');
  return row.id;
}

export const sortRows = (rows: ImportRow[]) =>
  rows.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.key.localeCompare(b.key));

/** Our accounts touched by an import, with the last date, for reconciliation after the commit. */
export function accountsOf(rows: readonly ImportRow[]) {
  const last = new Map<string, string>();
  for (const r of rows) {
    if ((last.get(r.accountId) ?? '') < r.occurredOn) last.set(r.accountId, r.occurredOn);
  }
  return [...last].map(([accountId, lastDate]) => ({ accountId, lastDate }));
}
