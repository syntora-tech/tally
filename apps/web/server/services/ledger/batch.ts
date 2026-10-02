import type { DbTransaction } from '@tally/db';
import { account, category, fxRate, posting, transaction } from '@tally/db/schema';
import { toDecimal } from '@tally/domain';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { mapDbError, serviceError, msg } from '../errors';
import {
  currencyCode,
  decimalString,
  localDateString,
  normalizeAddressIn,
  optionalNetwork,
  optionalText,
  requiredText,
} from '../fields';
import { bookTransaction, transactionInput, TX_TYPES } from '.';

// Batch writes for agents and bulk entry (spec 13.3, A-053): every batch is one DB transaction,
// supports a dry run, and reports per-item outcomes or per-item errors (`items.<index>`).

const dryRun = z.boolean().default(false).describe('Validate and preview without writing');

const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ItemErrors = Record<string, string[]>;

function batchFailure(errors: ItemErrors) {
  const count = Object.keys(errors).length;
  return serviceError('validation_error', msg('batch.failedItems', { count }), errors);
}

export const accountItem = z
  .object({
    name: requiredText('field.name').describe('Unique account name, e.g. "Privat USD"'),
    kind: z.enum(['bank', 'crypto', 'cash']),
    currency: currencyCode.describe('ISO code or stablecoin: USD, EUR, UAH, USDT, USDC'),
    network: optionalNetwork.describe(
      'Network of a crypto wallet: ETH, BSC, POLYGON, ARBITRUM, BASE, OPTIMISM, AVALANCHE, TRON, SOLANA, BTC, TON',
    ),
    address: optionalText.describe('Our wallet address on that network; identifies transfers'),
    openingBalance: decimalString.describe('Balance on openingDate as a decimal string'),
    openingDate: localDateString.describe('YYYY-MM-DD; the balance is opening + all postings'),
    isActive: z.boolean().default(true),
  })
  .transform(normalizeAddressIn('network', 'address'));

/** Accounts matched by name: created, updated in place, or left unchanged. */
export const upsertAccounts = defineService({
  name: 'ledger.accounts.upsertBatch',
  input: z.object({ accounts: z.array(accountItem).min(1).max(100), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const names = input.accounts.map((a) => a.name);
      const errors: ItemErrors = {};
      const duplicate = names.find((n, i) => names.indexOf(n) !== i);
      if (duplicate) errors.accounts = [msg('batch.duplicateName', { name: duplicate })];
      const existing = await tx.select().from(account).where(inArray(account.name, names));
      const results: { name: string; id: string; status: 'created' | 'updated' | 'unchanged' }[] =
        [];
      for (const [index, item] of input.accounts.entries()) {
        const current = existing.find((a) => a.name === item.name);
        if (!current) {
          const [row] = await tx.insert(account).values(item).returning({ id: account.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          results.push({ name: item.name, id: row.id, status: 'created' });
          continue;
        }
        const same =
          current.kind === item.kind &&
          current.currency === item.currency &&
          current.network === item.network &&
          current.address === item.address &&
          toDecimal(current.openingBalance).eq(item.openingBalance) &&
          current.openingDate === item.openingDate &&
          current.isActive === item.isActive;
        if (same) {
          results.push({ name: item.name, id: current.id, status: 'unchanged' });
          continue;
        }
        if (current.currency !== item.currency) {
          const [used] = await tx
            .select({ id: posting.id })
            .from(posting)
            .where(eq(posting.accountId, current.id))
            .limit(1);
          if (used) {
            errors[`accounts.${String(index)}`] = ['ledger.currencyLocked'];
            continue;
          }
        }
        await tx.update(account).set(item).where(eq(account.id, current.id));
        results.push({ name: item.name, id: current.id, status: 'updated' });
      }
      return Object.keys(errors).length ? err(batchFailure(errors)) : ok({ accounts: results });
    }),
});

export const categoryItem = z.object({
  txType: z.enum(TX_TYPES).describe('Transaction type the category belongs to'),
  name: requiredText('field.name').describe('Category name, unique within its type'),
});

/** Categories are insert-only by (type, name); existing ones are reported as such. */
export const upsertCategories = defineService({
  name: 'ledger.categories.upsertBatch',
  input: z.object({ categories: z.array(categoryItem).min(1).max(200), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const results: { txType: string; name: string; id: string; status: string }[] = [];
      for (const item of input.categories) {
        const [created] = await tx
          .insert(category)
          .values(item)
          .onConflictDoNothing()
          .returning({ id: category.id });
        if (created) {
          results.push({ ...item, id: created.id, status: 'created' });
          continue;
        }
        const [current] = await tx
          .select({ id: category.id })
          .from(category)
          .where(sql`${category.txType} = ${item.txType} and ${category.name} = ${item.name}`);
        if (!current) return err(serviceError('forbidden', 'general.forbidden'));
        results.push({ ...item, id: current.id, status: 'existing' });
      }
      return ok({ categories: results });
    }),
});

export const rateItem = z.object({
  onDate: localDateString.describe('YYYY-MM-DD'),
  base: currencyCode.describe('Currency being priced, e.g. USD in USD→UAH'),
  quote: currencyCode.default('UAH').describe('Currency of the price, default UAH'),
  rate: decimalString.describe('Units of quote per 1 base, e.g. "41.25" for USD→UAH'),
});

/** Manual rates (source `manual`, 5.4); a second rate for the same day and pair replaces it. */
export const setFxRates = defineService({
  name: 'fx.setManualBatch',
  input: z.object({ rates: z.array(rateItem).min(1).max(500), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: ItemErrors = {};
      for (const [index, item] of input.rates.entries()) {
        if (!toDecimal(item.rate).gt(0)) errors[`rates.${String(index)}`] = ['fx.ratePositive'];
        if (item.base === item.quote) {
          errors[`rates.${String(index)}`] = ['fx.samePair'];
        }
      }
      if (Object.keys(errors).length) return err(batchFailure(errors));
      for (const item of input.rates) {
        await tx
          .insert(fxRate)
          .values({ ...item, source: 'manual' })
          .onConflictDoUpdate({
            target: [fxRate.onDate, fxRate.base, fxRate.quote, fxRate.source],
            set: { rate: item.rate, updatedAt: sql`now()` },
          });
      }
      return ok({ saved: input.rates.length });
    }),
});

const legRef = z.object({
  account: z.string().trim().min(1).describe('Account id or exact account name'),
  amount: decimalString.describe(
    'Positive decimal string in the account currency, e.g. "1400.20"; the sign comes from the leg',
  ),
});

export const transactionItem = z.object({
  externalRef: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'Stable unique reference used for de-duplication: bank reference, tx hash, or "ledger:Transactions:R<row>" for rows of the legacy Ledger workbook',
    ),
  occurredOn: localDateString.describe('YYYY-MM-DD'),
  type: z.enum(TX_TYPES),
  category: z.string().trim().min(1).describe('Category id or name of a category of this type'),
  description: optionalText,
  counterparty: optionalText,
  from: legRef
    .optional()
    .describe('Money leaving an account: expense, and the source of two-leg types'),
  to: legRef.optional().describe('Money arriving: revenue, and the destination of two-leg types'),
  fee: legRef.optional().describe('Optional bank or network fee, booked as a negative posting'),
});

type TransactionOutcome = {
  index: number;
  externalRef: string;
  id: string;
  status: 'created' | 'duplicate';
};

/**
 * Books up to 500 transactions at once (spec 13.3 `propose_transactions`, written directly per
 * A-053). Items whose `externalRef` already exists — as an external or a legacy reference — are
 * skipped, so a batch can be re-sent safely. Each item is checked against I4/I5 on its own, so
 * errors point at the item; any error rolls the whole batch back.
 */
export const addTransactions = defineService({
  name: 'ledger.transactions.addBatch',
  input: z.object({ transactions: z.array(transactionItem).min(1).max(500), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: ItemErrors = {};
      const refs = input.transactions.map((t) => t.externalRef);
      refs.forEach((r, i) => {
        if (refs.indexOf(r) !== i)
          errors[`transactions.${String(i)}`] = [msg('batch.duplicateRef', { ref: r })];
      });
      const known = await existingRefs(tx, refs);
      const accounts = await tx.select({ id: account.id, name: account.name }).from(account);
      const categories = await tx
        .select({ id: category.id, name: category.name, txType: category.txType })
        .from(category);
      const accountId = (ref: string) =>
        accounts.find((a) => (uuidLike.test(ref) ? a.id === ref.toLowerCase() : a.name === ref))
          ?.id;

      const results: TransactionOutcome[] = [];
      for (const [index, item] of input.transactions.entries()) {
        const key = `transactions.${String(index)}`;
        if (errors[key]) continue;
        const duplicateOf = known.get(item.externalRef);
        if (duplicateOf) {
          results.push({
            index,
            externalRef: item.externalRef,
            id: duplicateOf,
            status: 'duplicate',
          });
          continue;
        }
        const problems: string[] = [];
        const leg = (l: z.output<typeof legRef> | undefined, name: string) => {
          if (!l) return undefined;
          const id = accountId(l.account);
          if (!id) problems.push(msg('batch.accountNotFound', { leg: name, account: l.account }));
          return { accountId: id ?? '', amount: l.amount };
        };
        const categoryId = categories.find((c) =>
          uuidLike.test(item.category)
            ? c.id === item.category.toLowerCase()
            : c.txType === item.type && c.name === item.category,
        )?.id;
        if (!categoryId)
          problems.push(
            msg('batch.categoryNotFound', { category: item.category, type: item.type }),
          );
        const resolved = {
          type: item.type,
          occurredOn: item.occurredOn,
          categoryId: categoryId ?? '',
          description: item.description,
          counterparty: item.counterparty,
          externalRef: item.externalRef,
          from: leg(item.from, 'from'),
          to: leg(item.to, 'to'),
          fee: leg(item.fee, 'fee'),
        };
        if (problems.length) {
          errors[key] = problems;
          continue;
        }
        const parsed = transactionInput.safeParse(resolved);
        if (!parsed.success) {
          errors[key] = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
          continue;
        }
        try {
          const row = await tx.transaction(async (sp) => {
            const booked = await bookTransaction(sp, parsed.data);
            // Checks this item's deferred I5 shape now, so a failure names the item.
            await sp.execute(sql`set constraints all immediate`);
            return booked;
          });
          results.push({ index, externalRef: item.externalRef, id: row.id, status: 'created' });
        } catch (error) {
          const mapped = mapDbError(error);
          if (!mapped) throw error;
          errors[key] = [mapped.message];
        } finally {
          await tx.execute(sql`set constraints all deferred`);
        }
      }
      if (Object.keys(errors).length) return err(batchFailure(errors));
      return ok({
        created: results.filter((r) => r.status === 'created').length,
        duplicates: results.filter((r) => r.status === 'duplicate').length,
        transactions: results,
      });
    }),
});

async function existingRefs(tx: DbTransaction, refs: string[]) {
  const rows = await tx
    .select({
      id: transaction.id,
      externalRef: transaction.externalRef,
      legacyRef: transaction.legacyRef,
    })
    .from(transaction)
    .where(or(inArray(transaction.externalRef, refs), inArray(transaction.legacyRef, refs)));
  const known = new Map<string, string>();
  for (const r of rows) {
    if (r.externalRef) known.set(r.externalRef, r.id);
    if (r.legacyRef) known.set(r.legacyRef, r.id);
  }
  return known;
}
