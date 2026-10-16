import {
  allocation,
  category,
  client,
  invoice,
  person,
  plannedPayment,
  posting,
  reimbursement,
  transaction,
  trip,
} from '@tally/db/schema';
import { addMonths, diffDays, toDecimal, type LocalDate } from '@tally/domain';
import { and, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { listPayroll } from '../payroll';
import { reimbursementPaid } from '../trips/reimbursements';

const USD_LIKE = ['USD', 'USDT', 'USDC'];
const sameCurrency = (a: string, b: string) =>
  a === b || (USD_LIKE.includes(a) && USD_LIKE.includes(b));
const PAYOUT_CATEGORIES = ['Contractors', 'Payroll'];

export type LinkTargets = {
  type: string;
  currency: string;
  /** What is still free to link, in the transaction's currency. */
  free: string;
  invoices: {
    id: string;
    label: string;
    currency: string;
    remaining: string;
    needsRate: boolean;
    match: boolean;
  }[];
  planned: { id: string; label: string; dueOn: string; amount: string; match: boolean }[];
  payouts: {
    itemId: string;
    periodId: string;
    label: string;
    month: string;
    remaining: string | null;
    currency: string;
    match: boolean;
  }[];
  reimbursements: { id: string; label: string; remaining: string; match: boolean }[];
};

/**
 * What a Ledger transaction can be linked to from its row (A-106): the same targets, by the same
 * rules, as the pickers on the invoice, planned expenses, payroll and trip pages — read the other
 * way round. The linking itself stays with those pages' services.
 */
export const linkTargets = defineService({
  name: 'allocations.linkTargets',
  input: z.object({ transactionId: z.uuid() }),
  handler: async (ctx, { transactionId }) => {
    const found = await inActorScope(ctx, async (tx) => {
      const [main] = await tx
        .select({
          type: transaction.type,
          occurredOn: transaction.occurredOn,
          personId: transaction.personId,
          clientId: transaction.clientId,
          categoryName: category.name,
          amount: sql<string>`abs(${posting.amount})`,
          currency: posting.currency,
          allocated: sql<string>`coalesce((select sum(a.amount * coalesce(a.fx_rate, 1)) from ${allocation} a where a.transaction_id = ${transaction.id}), 0)`,
        })
        .from(transaction)
        .innerJoin(
          posting,
          and(eq(posting.transactionId, transaction.id), eq(posting.isFee, false)),
        )
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .where(eq(transaction.id, transactionId))
        .orderBy(desc(sql`abs(${posting.amount})`))
        .limit(1);
      if (!main) return null;
      const free = toDecimal(main.amount).minus(main.allocated);
      const on = main.occurredOn as LocalDate;
      const open = free.gt(0);
      const invoices =
        open && main.type === 'revenue'
          ? await tx
              .select({
                id: invoice.id,
                number: invoice.number,
                clientId: invoice.clientId,
                clientName: sql<string>`coalesce(${client.shortName}, ${client.legalName})`,
                currency: invoice.currency,
                total: invoice.total,
                paidAmount: invoice.paidAmount,
                dueDate: invoice.dueDate,
              })
              .from(invoice)
              .innerJoin(client, eq(client.id, invoice.clientId))
              .where(inArray(invoice.status, ['issued', 'partially_paid']))
              .orderBy(invoice.dueDate)
          : [];
      const planned =
        open && main.type === 'expense'
          ? await tx
              .select({
                id: plannedPayment.id,
                name: plannedPayment.name,
                dueOn: plannedPayment.dueOn,
                amount: plannedPayment.amount,
                personId: plannedPayment.personId,
              })
              .from(plannedPayment)
              .where(
                and(
                  eq(plannedPayment.status, 'due'),
                  eq(plannedPayment.currency, main.currency),
                  // Paid late (up to two months) or a little ahead (a month); older ones are noise.
                  gte(plannedPayment.dueOn, addMonths(on, -2)),
                  lte(plannedPayment.dueOn, addMonths(on, 1)),
                ),
              )
          : [];
      const reimbursements =
        open && main.type === 'expense' && main.currency === 'UAH'
          ? await reimbursementPaid(
              tx,
              (
                await tx
                  .select({ r: reimbursement })
                  .from(reimbursement)
                  .where(ne(reimbursement.method, 'payroll'))
              ).map((x) => x.r),
            )
          : [];
      const unpaid = reimbursements.filter((r) => !r.paid);
      const names = unpaid.length
        ? await tx
            .select({ id: reimbursement.id, person: person.fullName, trip: trip.title })
            .from(reimbursement)
            .innerJoin(person, eq(person.id, reimbursement.personId))
            .innerJoin(trip, eq(trip.id, reimbursement.tripId))
            .where(
              inArray(
                reimbursement.id,
                unpaid.map((r) => r.id),
              ),
            )
        : [];
      return { main, free, on, invoices, planned, unpaid, names };
    });
    if (!found) return err(serviceError('not_found', 'ledger.txNotFound'));
    const { main, free, on } = found;

    const payroll =
      free.gt(0) &&
      main.type === 'expense' &&
      main.categoryName !== null &&
      PAYOUT_CATEGORIES.includes(main.categoryName)
        ? (await listPayroll.run(ctx, { periodId: '' })).unwrapOr([])
        : [];

    const byMatch = <T extends { match: boolean }>(rows: T[]) =>
      [...rows].sort((a, b) => Number(b.match) - Number(a.match));

    return ok<LinkTargets>({
      type: main.type,
      currency: main.currency,
      free: free.toFixed(2),
      invoices: byMatch(
        found.invoices
          .map((i) => ({
            id: i.id,
            label: `${i.clientName} · ${i.number ?? '—'}`,
            currency: i.currency,
            remaining: toDecimal(i.total).minus(i.paidAmount).toFixed(2),
            needsRate: !sameCurrency(main.currency, i.currency),
            match: i.clientId === main.clientId,
          }))
          .filter((i) => toDecimal(i.remaining).gt(0)),
      ),
      planned: byMatch(
        found.planned
          .map((p) => ({
            id: p.id,
            label: p.name,
            dueOn: p.dueOn,
            amount: toDecimal(p.amount).toFixed(2),
            match: main.personId !== null && p.personId === main.personId,
            distance: Math.abs(diffDays(p.dueOn as LocalDate, on)),
          }))
          .sort((a, b) => a.distance - b.distance)
          .map(({ distance: _, ...p }) => p),
      ),
      payouts: byMatch(
        payroll
          .filter(
            (i) =>
              i.group !== 'paid' &&
              i.month <= on &&
              (i.item.payoutMethod === 'fiat'
                ? main.currency === 'UAH'
                : USD_LIKE.includes(main.currency)),
          )
          .map((i) => ({
            itemId: i.item.id,
            periodId: i.item.periodId,
            label:
              i.item.kind === 'agency' ? (i.payeeName ?? '') : (i.personName ?? i.payeeName ?? ''),
            month: i.month,
            remaining: i.remaining,
            currency: i.currency,
            match: main.personId !== null && i.item.personId === main.personId,
          })),
      ),
      reimbursements: byMatch(
        found.unpaid.map((r) => {
          const n = found.names.find((x) => x.id === r.id);
          return {
            id: r.id,
            label: `${n?.person ?? ''} · ${n?.trip ?? ''}`,
            remaining: toDecimal(r.amount).minus(r.paidUah).toFixed(2),
            match: main.personId !== null && r.personId === main.personId,
          };
        }),
      ),
    });
  },
});
