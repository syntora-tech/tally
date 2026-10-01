import { account, allocation, invoice, posting, transaction } from '@tally/db/schema';
import { toDecimal } from '@tally/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { decimalString } from '../fields';

const USD_LIKE = ['USD', 'USDT', 'USDC'];
const sameCurrency = (a: string, b: string) =>
  a === b || (USD_LIKE.includes(a) && USD_LIKE.includes(b));

/** Revenue transactions with money not yet allocated, for the invoice payment picker (6.5). */
export const paymentCandidates = defineService({
  name: 'allocations.candidates',
  input: z.object({ invoiceId: z.uuid() }),
  handler: async (ctx, { invoiceId }) =>
    inActorScope(ctx, async (tx) => {
      const [inv] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId));
      if (!inv) return err(serviceError('not_found', 'Інвойс не знайдено'));
      const rows = await tx
        .select({
          id: transaction.id,
          occurredOn: transaction.occurredOn,
          counterparty: transaction.counterparty,
          description: transaction.description,
          amount: posting.amount,
          currency: posting.currency,
          accountName: account.name,
          used: sql<string>`coalesce((select sum(a.amount * coalesce(a.fx_rate, 1)) from ${allocation} a where a.transaction_id = "transaction"."id"), 0)`,
        })
        .from(transaction)
        .innerJoin(
          posting,
          and(eq(posting.transactionId, transaction.id), eq(posting.isFee, false)),
        )
        .innerJoin(account, eq(account.id, posting.accountId))
        .where(eq(transaction.type, 'revenue'))
        .orderBy(desc(transaction.occurredOn))
        .limit(200);
      return ok(
        rows
          .map((r) => ({
            ...r,
            remaining: toDecimal(r.amount).minus(r.used).toFixed(2),
            needsRate: !sameCurrency(r.currency, inv.currency),
          }))
          .filter((r) => toDecimal(r.remaining).gt(0)),
      );
    }),
});

export const allocateToInvoice = defineService({
  name: 'allocations.toInvoice',
  input: z.object({
    invoiceId: z.uuid(),
    transactionId: z.uuid({ error: 'Оберіть транзакцію' }),
    amount: decimalString,
    fxRate: z.preprocess((v) => (v === '' ? undefined : v), decimalString.optional()),
  }),
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const [inv] = await tx.select().from(invoice).where(eq(invoice.id, input.invoiceId));
      if (!inv) return err(serviceError('not_found', 'Інвойс не знайдено'));
      if (!toDecimal(input.amount).gt(0)) {
        return err(
          serviceError('validation_error', 'Сума має бути більша за 0', {
            amount: ['Сума має бути більша за 0'],
          }),
        );
      }
      const [row] = await tx
        .insert(allocation)
        .values({
          transactionId: input.transactionId,
          invoiceId: input.invoiceId,
          amount: input.amount,
          currency: inv.currency,
          fxRate: input.fxRate ?? null,
          fxSource: input.fxRate ? 'manual' : null,
        })
        .returning({ id: allocation.id });
      return row ? ok(row) : err(serviceError('forbidden', 'Недостатньо прав для цієї дії'));
    }),
});

export const removeAllocation = defineService({
  name: 'allocations.remove',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.delete(allocation).where(eq(allocation.id, id)).returning({ id: allocation.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'Розподіл не знайдено'));
  },
});

export const invoiceAllocations = defineService({
  name: 'allocations.ofInvoice',
  input: z.object({ invoiceId: z.uuid() }),
  handler: async (ctx, { invoiceId }) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx
          .select({
            id: allocation.id,
            amount: allocation.amount,
            currency: allocation.currency,
            fxRate: allocation.fxRate,
            occurredOn: transaction.occurredOn,
            counterparty: transaction.counterparty,
            transactionId: transaction.id,
          })
          .from(allocation)
          .innerJoin(transaction, eq(transaction.id, allocation.transactionId))
          .where(eq(allocation.invoiceId, invoiceId))
          .orderBy(transaction.occurredOn),
      ),
    ),
});
