import type { Db, DbTransaction } from '@tally/db';
import { fxRate, posting, transaction } from '@tally/db/schema';
import { addDays, suggestPayoutRate, type FxCandidates, type LocalDate } from '@tally/domain';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { withSystem } from '../../db/with-user';
import { fetchNbuRate, type Fetcher } from '../../fx/nbu';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { currencyCode, decimalString, localDateString } from '../fields';

/** Currencies whose NBU rate the daily cron keeps (5.4, 10.4). */
export const NBU_CURRENCIES = ['USD', 'EUR'] as const;

async function storedRate(
  tx: DbTransaction,
  onDate: string,
  base: string,
  source: 'nbu' | 'manual',
) {
  const [row] = await tx
    .select()
    .from(fxRate)
    .where(
      and(
        eq(fxRate.base, base),
        eq(fxRate.quote, 'UAH'),
        eq(fxRate.source, source),
        source === 'nbu' ? eq(fxRate.onDate, onDate) : lte(fxRate.onDate, onDate),
      ),
    )
    .orderBy(desc(fxRate.onDate))
    .limit(1);
  return row ?? null;
}

/**
 * NBU rate for a date from `fx_rate`, fetched and stored on a miss (5.4). Runs as a system actor
 * so any role that may see a payout can also warm the rate table.
 */
export async function ensureNbuRate(
  db: Db,
  currency: string,
  onDate: LocalDate,
  fetcher?: Fetcher,
) {
  const cached = await withSystem(db, 'system:fx', (tx) => storedRate(tx, onDate, currency, 'nbu'));
  if (cached) return ok({ rate: cached.rate, onDate: cached.onDate as LocalDate });
  const fetched = await fetchNbuRate(currency, onDate, fetcher);
  if (fetched.isErr()) return err(fetched.error);
  await withSystem(db, 'system:fx', (tx) =>
    tx
      .insert(fxRate)
      .values({ onDate, base: currency, quote: 'UAH', rate: fetched.value.rate, source: 'nbu' })
      .onConflictDoNothing(),
  );
  return ok({ rate: fetched.value.rate, onDate });
}

/** The `nbu-rates` cron (10.4): today's official rates for the tracked currencies. */
export async function syncNbuRates(db: Db, today: LocalDate, fetcher?: Fetcher) {
  const results = await Promise.all(
    NBU_CURRENCIES.map(async (c) => {
      const r = await ensureNbuRate(db, c, today, fetcher);
      return { currency: c, ...(r.isOk() ? { rate: r.value.rate } : { error: r.error.message }) };
    }),
  );
  return results;
}

/**
 * Payout rate suggestion USD→UAH for a date (5.4): latest Ledger exchange within 3 days, then
 * NBU, then the last manual rate.
 */
export const suggestRate = defineService({
  name: 'fx.suggest',
  input: z.object({ onDate: localDateString, fetchMissing: z.boolean().default(true) }),
  handler: async (ctx, { onDate, fetchMissing }) => {
    const local = await inActorScope(ctx, async (tx) => {
      const from = addDays(onDate, -3);
      const legs = await tx
        .select({
          id: transaction.id,
          occurredOn: transaction.occurredOn,
          amount: posting.amount,
          currency: posting.currency,
        })
        .from(transaction)
        .innerJoin(
          posting,
          and(eq(posting.transactionId, transaction.id), eq(posting.isFee, false)),
        )
        .where(
          and(
            eq(transaction.type, 'fx_exchange'),
            gte(transaction.occurredOn, from),
            lte(transaction.occurredOn, onDate),
          ),
        );
      const exchanges: FxCandidates['exchanges'][number][] = [];
      for (const id of new Set(legs.map((l) => l.id))) {
        const own = legs.filter((l) => l.id === id);
        const usd = own.find(
          (l) => ['USD', 'USDT', 'USDC'].includes(l.currency) && l.amount.startsWith('-'),
        );
        const uah = own.find((l) => l.currency === 'UAH' && !l.amount.startsWith('-'));
        if (usd && uah) {
          exchanges.push({
            occurredOn: usd.occurredOn as LocalDate,
            usd: usd.amount,
            uah: uah.amount,
          });
        }
      }
      const nbu = await storedRate(tx, onDate, 'USD', 'nbu');
      const manual = await storedRate(tx, onDate, 'USD', 'manual');
      return { exchanges, nbu, manual };
    });
    let nbu = local.nbu ? { onDate: local.nbu.onDate as LocalDate, rate: local.nbu.rate } : null;
    if (!nbu && fetchMissing && local.exchanges.length === 0) {
      const fetched = await ensureNbuRate(ctx.db, 'USD', onDate);
      if (fetched.isOk()) nbu = fetched.value;
    }
    const suggestion = suggestPayoutRate(onDate, {
      exchanges: local.exchanges,
      nbu,
      lastManual: local.manual
        ? { onDate: local.manual.onDate as LocalDate, rate: local.manual.rate }
        : null,
    });
    return ok(
      suggestion && {
        rate: suggestion.rate.toFixed(6),
        source: suggestion.source,
        onDate: suggestion.onDate,
      },
    );
  },
});

export const listRates = defineService({
  name: 'fx.list',
  input: z.object({ limit: z.number().int().min(1).max(500).default(60) }),
  handler: async (ctx, { limit }) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx
          .select()
          .from(fxRate)
          .orderBy(desc(fxRate.onDate), fxRate.base, fxRate.source)
          .limit(limit),
      ),
    ),
});

export const saveManualRate = defineService({
  name: 'fx.saveManual',
  input: z.object({ onDate: localDateString, base: currencyCode, rate: decimalString }),
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .insert(fxRate)
        .values({ ...input, quote: 'UAH', source: 'manual' })
        .onConflictDoUpdate({
          target: [fxRate.onDate, fxRate.base, fxRate.quote, fxRate.source],
          set: { rate: input.rate, updatedAt: sql`now()` },
        })
        .returning({ id: fxRate.id }),
    );
    return row ? ok(row) : err(serviceError('forbidden', 'Недостатньо прав для цієї дії'));
  },
});
