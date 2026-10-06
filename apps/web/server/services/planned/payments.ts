import type { DbTransaction } from '@tally/db';
import {
  account,
  allocation,
  category,
  person,
  plannedPayment,
  posting,
  transaction,
} from '@tally/db/schema';
import {
  addMonths,
  convertVia,
  endOfMonth,
  startOfMonth,
  toDecimal,
  type LocalDate,
} from '@tally/domain';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { decimalString, localDateString, optionalText, requiredText } from '../fields';
import { loadUsdConverter } from '../fx';
import { bookTransaction } from '../ledger';
import { syncChargesOfInstalment, syncPlannedPayments } from './sync';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const plannedPaymentFilters = z.object({
  /** Due dates from/to, inclusive; default: last month to the end of the next one. */
  from: z.preprocess(emptyToUndefined, localDateString.optional()),
  to: z.preprocess(emptyToUndefined, localDateString.optional()),
  status: z.preprocess(emptyToUndefined, z.enum(['due', 'paid', 'skipped']).optional()),
});

/**
 * Payments to make (A-082) with their charges under them and the Ledger expenses they are paid
 * by. Listing first brings the rules' payments up to date for the months around today.
 */
export const listPlannedPayments = defineService({
  name: 'planned.payments.list',
  input: plannedPaymentFilters,
  handler: async (ctx, f) => {
    const current = startOfMonth(ctx.today);
    const from = f.from ?? addMonths(current, -1);
    const to = f.to ?? endOfMonth(addMonths(current, 1));
    const result = await inActorScope(ctx, async (tx) => {
      await syncPlannedPayments(tx, ctx.today);
      const rows = await tx
        .select({
          payment: plannedPayment,
          categoryName: category.name,
          personName: person.fullName,
        })
        .from(plannedPayment)
        .innerJoin(category, eq(category.id, plannedPayment.categoryId))
        .leftJoin(person, eq(person.id, plannedPayment.personId))
        .where(
          and(
            gte(plannedPayment.dueOn, from),
            lte(plannedPayment.dueOn, to),
            f.status ? eq(plannedPayment.status, f.status) : undefined,
          ),
        )
        .orderBy(asc(plannedPayment.dueOn), asc(plannedPayment.name));
      const ids = rows.map((r) => r.payment.id);
      const links = ids.length
        ? await tx
            .select({
              plannedPaymentId: allocation.plannedPaymentId,
              allocationId: allocation.id,
              transactionId: transaction.id,
              occurredOn: transaction.occurredOn,
              amount: allocation.amount,
              currency: allocation.currency,
              description: transaction.description,
            })
            .from(allocation)
            .innerJoin(transaction, eq(transaction.id, allocation.transactionId))
            .where(inArray(allocation.plannedPaymentId, ids))
        : [];
      return rows.map((r) => ({
        ...r,
        overdue: r.payment.status === 'due' && r.payment.dueOn < ctx.today,
        transactions: links.filter((l) => l.plannedPaymentId === r.payment.id),
      }));
    });
    return ok(result);
  },
});

async function lockPayment(tx: DbTransaction, id: string) {
  const [row] = await tx
    .select()
    .from(plannedPayment)
    .where(eq(plannedPayment.id, id))
    .for('update');
  return row ?? null;
}

/**
 * Sets this month's amount by hand (A-082): for an instalment the gross (its net and charges are
 * recomputed), for anything else the amount itself. Rule edits leave it alone afterwards.
 */
export const setPlannedAmount = defineService({
  name: 'planned.payments.amount',
  input: z.object({
    id: z.uuid(),
    amount: decimalString.refine((v) => toDecimal(v).gte(0), 'field.nonNegative'),
  }),
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const row = await lockPayment(tx, input.id);
      if (!row) return err(serviceError('not_found', 'planned.paymentNotFound'));
      if (row.status !== 'due') return err(serviceError('conflict', 'planned.notDue'));
      const isInstalment = row.plannedExpenseId !== null && row.chargeId === null;
      if (!isInstalment) {
        await tx
          .update(plannedPayment)
          .set({ amount: toDecimal(input.amount).toFixed(2), amountOverridden: true })
          .where(eq(plannedPayment.id, row.id));
        return ok({ id: row.id, amount: toDecimal(input.amount).toFixed(2) });
      }
      const convert = convertVia(await loadUsdConverter(tx));
      const gross = toDecimal(input.amount).toFixed(8);
      const instalment = await syncChargesOfInstalment(tx, { ...row, gross }, convert);
      const net = (instalment?.net ?? toDecimal(input.amount)).toFixed(2);
      await tx
        .update(plannedPayment)
        .set({ gross, amount: net, amountOverridden: true })
        .where(eq(plannedPayment.id, row.id));
      return ok({ id: row.id, amount: net });
    }),
});

/** Back to the amounts of the rule (A-082). */
export const resetPlannedAmount = defineService({
  name: 'planned.payments.reset',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const row = await lockPayment(tx, id);
      if (!row) return err(serviceError('not_found', 'planned.paymentNotFound'));
      if (row.status !== 'due') return err(serviceError('conflict', 'planned.notDue'));
      await tx
        .update(plannedPayment)
        .set({ amountOverridden: false })
        .where(eq(plannedPayment.id, id));
      if (row.chargeId === null) {
        await tx
          .update(plannedPayment)
          .set({ amountOverridden: false })
          .where(and(eq(plannedPayment.parentId, id), eq(plannedPayment.status, 'due')));
      }
      if (row.plannedExpenseId && row.month >= startOfMonth(ctx.today)) {
        await syncPlannedPayments(tx, ctx.today, [row.plannedExpenseId]);
      }
      return ok({ id });
    }),
});

export const skipPlannedPayment = defineService({
  name: 'planned.payments.skip',
  input: z.object({ id: z.uuid(), reason: requiredText('planned.skipReason') }),
  handler: async (ctx, { id, reason }) =>
    inActorScope(ctx, async (tx) => {
      const row = await lockPayment(tx, id);
      if (!row) return err(serviceError('not_found', 'planned.paymentNotFound'));
      if (row.status !== 'due') return err(serviceError('conflict', 'planned.notDue'));
      // Skipping an instalment skips its unpaid charges: no salary, no tax on it.
      await tx
        .update(plannedPayment)
        .set({ status: 'skipped', skipReason: reason })
        .where(
          and(
            eq(plannedPayment.status, 'due'),
            sql`(${plannedPayment.id} = ${id} or ${plannedPayment.parentId} = ${id})`,
          ),
        );
      return ok({ id });
    }),
});

export const unskipPlannedPayment = defineService({
  name: 'planned.payments.unskip',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const row = await lockPayment(tx, id);
      if (!row) return err(serviceError('not_found', 'planned.paymentNotFound'));
      if (row.status !== 'skipped') return err(serviceError('conflict', 'planned.notSkipped'));
      await tx
        .update(plannedPayment)
        .set({ status: 'due', skipReason: null })
        .where(
          and(
            eq(plannedPayment.status, 'skipped'),
            sql`(${plannedPayment.id} = ${id} or ${plannedPayment.parentId} = ${id})`,
          ),
        );
      return ok({ id });
    }),
});

const mainPosting = (tx: DbTransaction, transactionId: string) =>
  tx
    .select({
      type: transaction.type,
      personId: transaction.personId,
      clientId: transaction.clientId,
      amount: sql<string>`abs(${posting.amount})`,
      currency: posting.currency,
      allocated: sql<string>`coalesce((select sum(a.amount * coalesce(a.fx_rate, 1)) from ${allocation} a where a.transaction_id = ${transaction.id}), 0)`,
    })
    .from(transaction)
    .innerJoin(posting, and(eq(posting.transactionId, transaction.id), eq(posting.isFee, false)))
    .where(eq(transaction.id, transactionId))
    .orderBy(desc(sql`abs(${posting.amount})`))
    .limit(1);

export const markPlannedPaidInput = z
  .object({
    id: z.uuid(),
    /** Expenses already in the Ledger (e.g. from a bank statement); their free amount is linked. */
    transactionIds: z.array(z.uuid()).max(20).optional(),
    /** Or book a new expense from this account. */
    accountId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    occurredOn: z.preprocess(emptyToUndefined, localDateString.optional()),
    amount: z.preprocess(emptyToUndefined, decimalString.optional()),
    /** Bank fee of the new expense, from the same or another account. */
    feeAmount: z.preprocess(emptyToUndefined, decimalString.optional()),
    feeAccountId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    description: optionalText,
  })
  .superRefine((v, issues) => {
    if (v.transactionIds?.length) return;
    if (!v.accountId) {
      issues.addIssue({ code: 'custom', path: ['accountId'], message: 'ledger.chooseFromAccount' });
    }
  });

export async function markPlannedPaidIn(
  tx: DbTransaction,
  today: LocalDate,
  input: z.output<typeof markPlannedPaidInput>,
) {
  const row = await lockPayment(tx, input.id);
  if (!row) return err(serviceError('not_found', 'planned.paymentNotFound'));
  if (row.status === 'skipped') return err(serviceError('conflict', 'planned.notDue'));
  const ids = [...(input.transactionIds ?? [])];
  if (ids.length === 0) {
    const [acc] = await tx
      .select()
      .from(account)
      .where(eq(account.id, input.accountId ?? ''));
    if (!acc) return err(serviceError('not_found', 'ledger.accountNotFound'));
    if (acc.currency !== row.currency) {
      return err(
        serviceError(
          'validation_error',
          msg('planned.accountCurrency', { currency: row.currency }),
          {
            accountId: ['planned.chooseAccountInCurrency'],
          },
        ),
      );
    }
    const fee = input.feeAmount && toDecimal(input.feeAmount).gt(0) ? input.feeAmount : null;
    const booked = await bookTransaction(
      tx,
      {
        type: 'expense',
        occurredOn: input.occurredOn ?? today,
        categoryId: row.categoryId,
        description: input.description ?? row.name,
        counterparty: row.counterparty,
        externalRef: null,
        personId: row.personId,
        clientId: null,
        counterpartyAddress: null,
        from: { accountId: acc.id, amount: input.amount ?? toDecimal(row.amount).toFixed(2) },
        to: undefined,
        fee: fee ? { accountId: input.feeAccountId ?? acc.id, amount: fee } : undefined,
      },
      { personId: row.personId, clientId: null, counterpartyAddress: null },
    );
    ids.push(booked.id);
  }
  for (const transactionId of ids) {
    const [main] = await mainPosting(tx, transactionId);
    if (!main) return err(serviceError('not_found', 'ledger.txNotFound'));
    const free = toDecimal(main.amount).minus(toDecimal(main.allocated));
    if (main.type !== 'expense' || free.lte(0)) {
      return err(
        serviceError('validation_error', 'planned.transactionMismatch', {
          transactionIds: ['planned.chooseFreeExpense'],
        }),
      );
    }
    if (main.personId === null && main.clientId === null && row.personId !== null) {
      await tx
        .update(transaction)
        .set({ personId: row.personId })
        .where(eq(transaction.id, transactionId));
    }
    await tx.insert(allocation).values({
      transactionId,
      plannedPaymentId: row.id,
      amount: free.toFixed(8),
      currency: main.currency,
    });
  }
  return ok({ id: row.id, transactionIds: ids });
}

/** "Paid" (A-082): links Ledger expenses to the payment, or books a new one with its fee. */
export const markPlannedPaid = defineService({
  name: 'planned.payments.pay',
  input: markPlannedPaidInput,
  handler: async (ctx, input) => inActorScope(ctx, (tx) => markPlannedPaidIn(tx, ctx.today, input)),
});

/** Unlinks Ledger expenses from a payment (all when none given); the expenses stay. */
export const unlinkPlannedPayment = defineService({
  name: 'planned.payments.unlink',
  input: z.object({ id: z.uuid(), transactionIds: z.array(z.uuid()).optional() }),
  handler: async (ctx, { id, transactionIds }) =>
    inActorScope(ctx, async (tx) => {
      const removed = await tx
        .delete(allocation)
        .where(
          and(
            eq(allocation.plannedPaymentId, id),
            transactionIds?.length ? inArray(allocation.transactionId, transactionIds) : undefined,
          ),
        )
        .returning({ id: allocation.id });
      if (removed.length === 0) return err(serviceError('not_found', 'planned.paymentNotLinked'));
      return ok({ id, unlinked: removed.length });
    }),
});

/** Expenses of a currency with money not allocated yet, for "Paid" from a statement row. */
export const plannedPaymentCandidates = defineService({
  name: 'planned.payments.candidates',
  input: z.object({ currency: z.string(), since: localDateString, until: localDateString }),
  handler: async (ctx, { currency, since, until }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: transaction.id,
          occurredOn: transaction.occurredOn,
          description: transaction.description,
          counterparty: transaction.counterparty,
          amount: sql<string>`abs(${posting.amount})`,
          allocated: sql<string>`coalesce((select sum(a.amount * coalesce(a.fx_rate, 1)) from ${allocation} a where a.transaction_id = ${transaction.id}), 0)`,
        })
        .from(transaction)
        .innerJoin(
          posting,
          and(eq(posting.transactionId, transaction.id), eq(posting.isFee, false)),
        )
        .where(
          and(
            eq(transaction.type, 'expense'),
            eq(posting.currency, currency),
            gte(transaction.occurredOn, since),
            lte(transaction.occurredOn, until),
          ),
        )
        .orderBy(desc(transaction.occurredOn)),
    );
    return ok(rows.filter((r) => toDecimal(r.amount).gt(toDecimal(r.allocated))));
  },
});
