import type { DbTransaction } from '@tally/db';
import {
  account,
  allocation,
  category,
  client,
  cryptoWallet,
  person,
  posting,
  transaction,
  type TxType,
} from '@tally/db/schema';
import { derivedRate, isCryptoNetwork, normalizeWalletAddress, toDecimal } from '@tally/domain';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError, type ServiceError } from '../errors';
import {
  checkbox,
  currencyCode,
  decimalString,
  localDateString,
  normalizeAddressIn,
  optionalLocalDate,
  optionalNetwork,
  optionalText,
  requiredText,
} from '../fields';

export const TX_TYPES = [
  'revenue',
  'expense',
  'transfer',
  'fx_exchange',
  'crypto_buy',
  'crypto_sell',
  'crypto_swap',
  'adjustment',
] as const satisfies readonly TxType[];

/** Types with a source and a destination leg (I5). */
export const TWO_LEG_TYPES: readonly TxType[] = [
  'transfer',
  'fx_exchange',
  'crypto_buy',
  'crypto_sell',
  'crypto_swap',
];

const balanceSql = sql<string>`${account.openingBalance} + coalesce((select sum(p.amount) from ${posting} p where p.account_id = "account"."id"), 0)`;

export const listAccounts = defineService({
  name: 'ledger.accounts.list',
  input: z.object({ includeInactive: z.boolean().default(false) }),
  handler: async (ctx, { includeInactive }) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx
          .select({ account, balance: balanceSql })
          .from(account)
          .where(includeInactive ? undefined : eq(account.isActive, true))
          .orderBy(asc(account.name)),
      ),
    ),
});

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const accountInput = z
  .object({
    id: z.preprocess(emptyToUndefined, z.uuid().optional()),
    name: requiredText('field.name'),
    kind: z.enum(['bank', 'crypto', 'cash'], { error: 'field.kind' }),
    currency: currencyCode,
    network: optionalNetwork,
    address: optionalText,
    openingBalance: decimalString,
    openingDate: localDateString,
    isActive: checkbox,
  })
  .transform(normalizeAddressIn('network', 'address'));

/** The currency of an account with postings is fixed: I4 was checked against it. */
export const saveAccount = defineService({
  name: 'ledger.accounts.save',
  input: accountInput,
  handler: async (ctx, { id, ...values }) =>
    inActorScope(ctx, async (tx) => {
      if (!id) {
        const [row] = await tx.insert(account).values(values).returning({ id: account.id });
        return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
      }
      const [current] = await tx.select().from(account).where(eq(account.id, id));
      if (!current) return err(serviceError('not_found', 'ledger.accountNotFound'));
      if (current.currency !== values.currency) {
        const [used] = await tx
          .select({ id: posting.id })
          .from(posting)
          .where(eq(posting.accountId, id))
          .limit(1);
        if (used) {
          return err(
            serviceError('validation_error', 'ledger.currencyLocked', {
              currency: ['ledger.currencyLocked'],
            }),
          );
        }
      }
      const [row] = await tx
        .update(account)
        .set(values)
        .where(eq(account.id, id))
        .returning({ id: account.id });
      return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
    }),
});

export const listCategories = defineService({
  name: 'ledger.categories.list',
  input: z.object({}),
  handler: async (ctx) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx.select().from(category).orderBy(asc(category.txType), asc(category.name)),
      ),
    ),
});

export const saveCategory = defineService({
  name: 'ledger.categories.save',
  input: z.object({ txType: z.enum(TX_TYPES), name: requiredText('field.name') }),
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.insert(category).values(input).returning({ id: category.id }),
    );
    return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
  },
});

const optionalUuid = z.preprocess(emptyToUndefined, z.uuid().optional());

export const journalFilters = z.object({
  from: optionalLocalDate,
  to: optionalLocalDate,
  type: z.preprocess(emptyToUndefined, z.enum(TX_TYPES).optional()),
  categoryId: optionalUuid,
  accountId: optionalUuid,
  /** Revenue/expense whose main posting is not fully allocated yet. */
  unallocated: checkbox,
  limit: z.number().int().min(1).max(1000).default(300),
});

const mainAmount = sql<
  string | null
>`(select abs(p.amount) from ${posting} p where p.transaction_id = "transaction"."id" and not p.is_fee order by abs(p.amount) desc limit 1)`;
const allocated = sql<string>`coalesce((select sum(a.amount * coalesce(a.fx_rate, 1)) from ${allocation} a where a.transaction_id = "transaction"."id"), 0)`;

export const listTransactions = defineService({
  name: 'ledger.transactions.list',
  input: journalFilters,
  handler: async (ctx, f) => {
    const rows = await inActorScope(ctx, async (tx) => {
      const conditions = [
        f.from ? gte(transaction.occurredOn, f.from) : undefined,
        f.to ? lte(transaction.occurredOn, f.to) : undefined,
        f.type ? eq(transaction.type, f.type) : undefined,
        f.categoryId ? eq(transaction.categoryId, f.categoryId) : undefined,
        f.accountId
          ? sql`exists (select 1 from ${posting} p where p.transaction_id = "transaction"."id" and p.account_id = ${f.accountId})`
          : undefined,
        f.unallocated
          ? and(
              inArray(transaction.type, ['revenue', 'expense']),
              sql`${allocated} < ${mainAmount}`,
            )
          : undefined,
      ];
      const txs = await tx
        .select({
          transaction,
          categoryName: category.name,
          personName: person.fullName,
          clientName: sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`,
          mainAmount,
          allocated,
        })
        .from(transaction)
        .innerJoin(category, eq(category.id, transaction.categoryId))
        .leftJoin(person, eq(person.id, transaction.personId))
        .leftJoin(client, eq(client.id, transaction.clientId))
        .where(and(...conditions))
        .orderBy(desc(transaction.occurredOn), desc(transaction.createdAt))
        .limit(f.limit);
      const postings = txs.length
        ? await tx
            .select({ posting, accountName: account.name, network: account.network })
            .from(posting)
            .innerJoin(account, eq(account.id, posting.accountId))
            .where(
              inArray(
                posting.transactionId,
                txs.map((t) => t.transaction.id),
              ),
            )
        : [];
      return txs.map((t) => ({
        ...t,
        postings: postings
          .filter((p) => p.posting.transactionId === t.transaction.id)
          .map((p) => ({ ...p.posting, accountName: p.accountName, network: p.network })),
      }));
    });
    return ok(rows);
  },
});

const leg = z.object({
  accountId: z.uuid({ error: 'ledger.chooseAccount' }),
  amount: decimalString,
});
const optionalLeg = z.preprocess(
  (v) => (v && typeof v === 'object' && !('accountId' in v && v.accountId) ? undefined : v),
  leg.optional(),
);

const optionalParty = z
  .preprocess(emptyToUndefined, z.uuid().optional())
  .transform((v) => v ?? null);

export const transactionInput = z
  .object({
    type: z.enum(TX_TYPES),
    occurredOn: localDateString,
    categoryId: z.uuid({ error: 'ledger.chooseCategory' }),
    description: optionalText,
    counterparty: optionalText,
    externalRef: optionalText,
    /** Party the money came from / went to (A-061); at most one. */
    personId: optionalParty,
    clientId: optionalParty,
    /** Counterparty wallet of a crypto transaction; its known owner becomes the party. */
    counterpartyAddress: optionalText,
    /** Money leaving an account (expense, source of two-leg types); amount entered positive. */
    from: optionalLeg,
    /** Money arriving (revenue, destination of two-leg types). */
    to: optionalLeg,
    /** Optional bank/network fee, always booked negative. */
    fee: optionalLeg,
  })
  .superRefine((t, c) => {
    const need = (key: 'from' | 'to', message: string) => {
      if (!t[key]) c.addIssue({ code: 'custom', path: [key, 'accountId'], message });
    };
    if (t.type === 'revenue') need('to', 'ledger.chooseToAccount');
    if (t.type === 'expense') need('from', 'ledger.chooseFromAccount');
    if (TWO_LEG_TYPES.includes(t.type)) {
      need('from', 'ledger.chooseFromAccount');
      need('to', 'ledger.chooseDestinationAccount');
    }
    if (t.personId && t.clientId) {
      c.addIssue({ code: 'custom', path: ['clientId'], message: 'ledger.oneParty' });
    }
    if (t.type === 'adjustment' && Boolean(t.from) === Boolean(t.to)) {
      c.addIssue({ code: 'custom', path: ['to', 'accountId'], message: 'ledger.chooseOneAccount' });
    }
    for (const key of ['from', 'to', 'fee'] as const) {
      const amount = t[key]?.amount;
      if (amount !== undefined && !toDecimal(amount).gt(0)) {
        c.addIssue({ code: 'custom', path: [key, 'amount'], message: 'field.positive' });
      }
    }
  });

export type TransactionInput = z.output<typeof transactionInput>;

type Party = {
  personId: string | null;
  clientId: string | null;
  counterpartyAddress: string | null;
};

/**
 * The party of a transaction (A-061). A counterparty address is validated for the network of the
 * crypto account in the legs and stored canonically; when no party is chosen, the owner of that
 * wallet becomes the party.
 */
export async function resolveParty(
  tx: DbTransaction,
  input: TransactionInput,
): Promise<Result<Party, ServiceError>> {
  let { personId, clientId } = input;
  if (!input.counterpartyAddress) return ok({ personId, clientId, counterpartyAddress: null });
  const ids = [input.from, input.to].flatMap((l) => (l ? [l.accountId] : []));
  const networks = ids.length
    ? await tx
        .select({ network: account.network })
        .from(account)
        .where(and(inArray(account.id, ids), eq(account.kind, 'crypto')))
    : [];
  const network = networks.map((n) => n.network).find((n) => n !== null);
  if (!network || !isCryptoNetwork(network)) {
    return err(
      serviceError('validation_error', 'ledger.addressNeedsCrypto', {
        counterpartyAddress: ['ledger.addressNeedsCrypto'],
      }),
    );
  }
  const address = normalizeWalletAddress(network, input.counterpartyAddress);
  if (address.isErr()) {
    return err(
      serviceError('validation_error', 'field.walletAddress', {
        counterpartyAddress: ['field.walletAddress'],
      }),
    );
  }
  if (!personId && !clientId) {
    const [owner] = await tx
      .select({ personId: cryptoWallet.personId, clientId: cryptoWallet.clientId })
      .from(cryptoWallet)
      .where(and(eq(cryptoWallet.network, network), eq(cryptoWallet.address, address.value)));
    personId = owner?.personId ?? null;
    clientId = owner?.clientId ?? null;
  }
  return ok({ personId, clientId, counterpartyAddress: address.value });
}

type NewPosting = { accountId: string; amount: string; isFee: boolean };

/** Signed postings of an input: `from` and `fee` leave (negative), `to` arrives. */
function postingsOf(input: TransactionInput): NewPosting[] {
  return [
    input.from && {
      accountId: input.from.accountId,
      amount: toDecimal(input.from.amount).neg().toString(),
      isFee: false,
    },
    input.to && { accountId: input.to.accountId, amount: input.to.amount, isFee: false },
    input.fee && {
      accountId: input.fee.accountId,
      amount: toDecimal(input.fee.amount).neg().toString(),
      isFee: true,
    },
  ].filter((p) => p !== undefined);
}

async function insertPostings(tx: DbTransaction, transactionId: string, postings: NewPosting[]) {
  const accounts = await tx
    .select({ id: account.id, currency: account.currency })
    .from(account)
    .where(
      inArray(
        account.id,
        postings.map((p) => p.accountId),
      ),
    );
  const currencyOf = (id: string) => accounts.find((a) => a.id === id)?.currency ?? '';
  await tx
    .insert(posting)
    .values(postings.map((p) => ({ transactionId, ...p, currency: currencyOf(p.accountId) })));
}

/**
 * Books a transaction with its postings in one DB transaction; currencies come from the accounts
 * (I4) and the shape is verified by the DB at commit (I5).
 */
export async function bookTransaction(tx: DbTransaction, input: TransactionInput, party: Party) {
  const [row] = await tx
    .insert(transaction)
    .values({
      occurredOn: input.occurredOn,
      type: input.type,
      categoryId: input.categoryId,
      description: input.description,
      counterparty: input.counterparty,
      externalRef: input.externalRef,
      ...party,
    })
    .returning({ id: transaction.id });
  if (!row) throw new Error('Transaction insert returned no row');
  await insertPostings(tx, row.id, postingsOf(input));
  return row;
}

export const createTransaction = defineService({
  name: 'ledger.transactions.create',
  input: transactionInput,
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const party = await resolveParty(tx, input);
      return party.isErr() ? err(party.error) : ok(await bookTransaction(tx, input, party.value));
    }),
});

const samePostings = (a: readonly NewPosting[], b: readonly NewPosting[]) => {
  const key = (p: NewPosting) =>
    `${p.accountId}|${toDecimal(p.amount).toString()}|${String(p.isFee)}`;
  return a.length === b.length && a.map(key).sort().join() === b.map(key).sort().join();
};

export const transactionUpdateInput = z
  .object({
    id: z.uuid(),
    reason: optionalText.describe(
      'Required when the type, accounts or amounts of an allocated transaction change; kept in the audit log',
    ),
  })
  .and(transactionInput);

/**
 * Manual edit of a transaction (A-061): every field can change. When money of an allocated
 * transaction changes (type, accounts, amounts) a reason is required; the DB re-checks that the
 * allocations still fit (I7) and the shape (I5) at commit.
 */
export async function editTransaction(
  tx: DbTransaction,
  { id, reason, ...input }: z.output<typeof transactionUpdateInput>,
): Promise<Result<{ id: string; status: 'updated' | 'unchanged' }, ServiceError>> {
  const [current] = await tx.select().from(transaction).where(eq(transaction.id, id));
  if (!current) return err(serviceError('not_found', 'ledger.txNotFound'));
  const party = await resolveParty(tx, input);
  if (party.isErr()) return err(party.error);
  const stored = await tx
    .select({ accountId: posting.accountId, amount: posting.amount, isFee: posting.isFee })
    .from(posting)
    .where(eq(posting.transactionId, id));
  const next = postingsOf(input);
  const moneyChanged = current.type !== input.type || !samePostings(stored, next);
  if (moneyChanged && !reason) {
    const [linked] = await tx
      .select({ id: allocation.id })
      .from(allocation)
      .where(eq(allocation.transactionId, id))
      .limit(1);
    if (linked) {
      return err(
        serviceError('validation_error', 'ledger.editReason', { reason: ['ledger.editReason'] }),
      );
    }
  }
  const values = {
    occurredOn: input.occurredOn,
    type: input.type,
    categoryId: input.categoryId,
    description: input.description,
    counterparty: input.counterparty,
    externalRef: input.externalRef,
    ...party.value,
  };
  const unchanged =
    !moneyChanged &&
    (Object.keys(values) as (keyof typeof values)[]).every((k) => current[k] === values[k]);
  if (unchanged) return ok({ id, status: 'unchanged' });
  if (reason) await tx.execute(sql`select set_config('app.reason', ${reason}, true)`);
  await tx.update(transaction).set(values).where(eq(transaction.id, id));
  if (moneyChanged) {
    await tx.delete(posting).where(eq(posting.transactionId, id));
    await insertPostings(tx, id, next);
  }
  return ok({ id, status: 'updated' });
}

export const updateTransaction = defineService({
  name: 'ledger.transactions.update',
  input: transactionUpdateInput,
  handler: (ctx, input) => inActorScope(ctx, (tx) => editTransaction(tx, input)),
});

export const getTransaction = defineService({
  name: 'ledger.transactions.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const found = await inActorScope(ctx, async (tx) => {
      const [row] = await tx.select().from(transaction).where(eq(transaction.id, id));
      if (!row) return null;
      const postings = await tx.select().from(posting).where(eq(posting.transactionId, id));
      const [linked] = await tx
        .select({ id: allocation.id })
        .from(allocation)
        .where(eq(allocation.transactionId, id))
        .limit(1);
      return { transaction: row, postings, allocated: Boolean(linked) };
    });
    return found ? ok(found) : err(serviceError('not_found', 'ledger.txNotFound'));
  },
});

/** Allocated money stays tied to its documents: unlink allocations before deleting. */
export const deleteTransaction = defineService({
  name: 'ledger.transactions.delete',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const [linked] = await tx
        .select({ id: allocation.id })
        .from(allocation)
        .where(eq(allocation.transactionId, id))
        .limit(1);
      if (linked) {
        return err(serviceError('conflict', 'ledger.txAllocated'));
      }
      const [row] = await tx
        .delete(transaction)
        .where(eq(transaction.id, id))
        .returning({ id: transaction.id });
      return row ? ok(row) : err(serviceError('not_found', 'ledger.txNotFound'));
    }),
});

/** Rate implied by an exchange's two legs (5.4), shown next to two-leg transactions. */
export function impliedRate(postings: readonly { amount: string; isFee: boolean }[]) {
  const legs = postings.filter((p) => !p.isFee);
  const out = legs.find((p) => toDecimal(p.amount).isNeg());
  const into = legs.find((p) => toDecimal(p.amount).gt(0));
  return out && into ? derivedRate(out.amount, into.amount) : null;
}
