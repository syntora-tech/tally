import type { DbTransaction } from '@tally/db';
import {
  account,
  adjustment,
  allocation,
  category,
  contract,
  payrollItem,
  person,
  reimbursement,
  supplierAct,
  transaction,
  trip,
  type Reimbursement,
} from '@tally/db/schema';
import { endOfMonth, startOfMonth, sum, toDecimal, type LocalDate } from '@tally/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { decimalString, localDateString, optionalText } from '../fields';
import { bookTransaction } from '../ledger';

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

/**
 * What has been paid of each reimbursement (A-070): its allocations; for the payroll method, the
 * whole amount once the payout carrying its adjustment is paid; legacy ones marked `paid`.
 */
export async function reimbursementPaid(tx: DbTransaction, rows: Reimbursement[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const allocations = await tx
    .select({ reimbursementId: allocation.reimbursementId, amount: allocation.amount })
    .from(allocation)
    .where(inArray(allocation.reimbursementId, ids));
  const adjustmentIds = rows.flatMap((r) => (r.adjustmentId ? [r.adjustmentId] : []));
  const paidAdjustments = adjustmentIds.length
    ? await tx
        .select({ id: adjustment.id })
        .from(adjustment)
        .innerJoin(
          payrollItem,
          and(
            eq(payrollItem.periodId, adjustment.periodId),
            eq(payrollItem.personId, adjustment.personId),
            eq(payrollItem.payoutMethod, adjustment.payoutMethod),
          ),
        )
        .where(and(inArray(adjustment.id, adjustmentIds), eq(payrollItem.status, 'paid')))
    : [];
  return rows.map((r) => {
    const settled =
      r.status === 'paid' ||
      (r.adjustmentId !== null && paidAdjustments.some((a) => a.id === r.adjustmentId));
    const allocated = sum(
      allocations.filter((a) => a.reimbursementId === r.id).map((a) => a.amount),
    );
    const paidUah = settled ? toDecimal(r.amount) : allocated;
    return { ...r, paidUah: paidUah.toFixed(2), paid: paidUah.gte(r.amount) };
  });
}

export const createReimbursementInput = z
  .object({
    tripId: z.uuid(),
    personId: z.uuid({ error: 'trips.choosePerson' }),
    amount: decimalString.refine((v) => toDecimal(v).gt(0), 'field.positive'),
    method: z.enum(['payroll', 'act', 'direct_payment']),
    /** `payroll`: the open period whose payout carries it. */
    periodId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    /** `act` / `direct_payment`: who receives the money (an extra act needs a FOP contract). */
    payeeId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    actDate: z.preprocess(emptyToUndefined, localDateString.optional()),
    notes: optionalText,
  })
  .superRefine((r, issues) => {
    if (r.method === 'payroll' && !r.periodId) {
      issues.addIssue({ code: 'custom', path: ['periodId'], message: 'trips.choosePeriod' });
    }
    if (r.method === 'act' && !r.payeeId) {
      issues.addIssue({ code: 'custom', path: ['payeeId'], message: 'trips.choosePayee' });
    }
    if (r.method === 'act' && !r.actDate) {
      issues.addIssue({ code: 'custom', path: ['actDate'], message: 'field.date' });
    }
  });

/**
 * Reimbursement of a trip (6.8): through the monthly payout (an adjustment `trip_reimbursement`
 * in an open period), an extra FOP act (draft, then paid like a direct payment) or a payment.
 */
export const createReimbursement = defineService({
  name: 'trips.createReimbursement',
  input: createReimbursementInput,
  handler: async (ctx, input) =>
    inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
      const [t] = await tx.select().from(trip).where(eq(trip.id, input.tripId));
      if (!t) return err(serviceError('not_found', 'trips.notFound'));
      let adjustmentId: string | null = null;
      if (input.method === 'payroll' && input.periodId) {
        const [adj] = await tx
          .insert(adjustment)
          .values({
            periodId: input.periodId,
            personId: input.personId,
            payoutMethod: 'fiat',
            kind: 'trip_reimbursement',
            amount: input.amount,
            currency: 'UAH',
            reason: `Trip reimbursement: ${t.title}`,
          })
          .returning({ id: adjustment.id });
        adjustmentId = adj?.id ?? null;
      }
      const payeeId =
        input.payeeId ??
        (
          await tx
            .select({ id: person.defaultPayeeId })
            .from(person)
            .where(eq(person.id, input.personId))
        )[0]?.id ??
        null;
      const [row] = await tx
        .insert(reimbursement)
        .values({
          tripId: input.tripId,
          personId: input.personId,
          payeeId,
          amount: toDecimal(input.amount).toFixed(2),
          method: input.method,
          adjustmentId,
          notes: input.notes,
        })
        .returning({ id: reimbursement.id });
      if (!row) return err(serviceError('forbidden', 'general.forbidden'));
      if (input.method === 'act' && payeeId && input.actDate) {
        const [fop] = await tx
          .select({ id: contract.id })
          .from(contract)
          .where(and(eq(contract.payeeId, payeeId), eq(contract.kind, 'fop')))
          .orderBy(desc(contract.signedOn))
          .limit(1);
        if (!fop) {
          return err(
            serviceError('validation_error', 'trips.noFopContract', {
              payeeId: ['trips.noFopContract'],
            }),
          );
        }
        const from = (t.startsOn ?? startOfMonth(input.actDate)) as LocalDate;
        await tx.insert(supplierAct).values({
          contractId: fop.id,
          payeeId,
          reimbursementId: row.id,
          type: 'reimbursement',
          actDate: input.actDate,
          periodFrom: from,
          periodTo: (t.endsOn ?? endOfMonth(from)) as LocalDate,
          amountUah: toDecimal(input.amount).toFixed(2),
        });
      }
      return ok({ id: row.id, tripId: input.tripId });
    }),
});

export const payReimbursementInput = z
  .object({
    reimbursementId: z.uuid(),
    amount: decimalString.refine((v) => toDecimal(v).gt(0), 'field.positive'),
    /** A new UAH expense from this account… */
    accountId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    occurredOn: z.preprocess(emptyToUndefined, localDateString.optional()),
    /** …or an expense already in the Ledger. */
    transactionId: z.preprocess(emptyToUndefined, z.uuid().optional()),
  })
  .superRefine((p, issues) => {
    if (!p.transactionId && !p.accountId) {
      issues.addIssue({ code: 'custom', path: ['accountId'], message: 'ledger.chooseFromAccount' });
    }
  });

/** Pays an `act` or `direct_payment` reimbursement: an expense allocated to it (I7, A-070). */
export const payReimbursement = defineService({
  name: 'trips.payReimbursement',
  input: payReimbursementInput,
  handler: async (ctx, input) =>
    inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
      const [r] = await tx
        .select({ r: reimbursement, title: trip.title, name: person.fullName })
        .from(reimbursement)
        .innerJoin(trip, eq(trip.id, reimbursement.tripId))
        .innerJoin(person, eq(person.id, reimbursement.personId))
        .where(eq(reimbursement.id, input.reimbursementId));
      if (!r) return err(serviceError('not_found', 'trips.reimbursementNotFound'));
      if (r.r.method === 'payroll') {
        return err(serviceError('conflict', 'trips.paidWithPayroll'));
      }
      let transactionId = input.transactionId;
      if (!transactionId && input.accountId) {
        const [acc] = await tx.select().from(account).where(eq(account.id, input.accountId));
        if (!acc) return err(serviceError('not_found', 'ledger.accountNotFound'));
        if (acc.currency !== 'UAH') {
          return err(
            serviceError('validation_error', 'payroll.accountCurrency', {
              accountId: ['payroll.chooseUahAccount'],
            }),
          );
        }
        const [cat] = await tx
          .select({ id: category.id })
          .from(category)
          .where(and(eq(category.txType, 'expense'), eq(category.name, 'Travel / Conf.')));
        if (!cat) return err(serviceError('not_found', 'trips.noTravelCategory'));
        const booked = await bookTransaction(
          tx,
          {
            type: 'expense',
            occurredOn: input.occurredOn ?? ctx.today,
            categoryId: cat.id,
            description: `Trip reimbursement: ${r.title}`,
            counterparty: r.name,
            externalRef: null,
            personId: r.r.personId,
            clientId: null,
            counterpartyAddress: null,
            from: { accountId: acc.id, amount: input.amount },
            to: undefined,
            fee: undefined,
          },
          { personId: r.r.personId, clientId: null, counterpartyAddress: null },
        );
        transactionId = booked.id;
      }
      if (!transactionId) return err(serviceError('validation_error', 'ledger.chooseFromAccount'));
      const [linked] = await tx
        .select({ type: transaction.type })
        .from(transaction)
        .where(eq(transaction.id, transactionId));
      if (linked?.type !== 'expense') {
        return err(
          serviceError('validation_error', 'trips.notExpense', {
            transactionId: ['trips.notExpense'],
          }),
        );
      }
      await tx.insert(allocation).values({
        transactionId,
        reimbursementId: r.r.id,
        amount: input.amount,
        currency: 'UAH',
      });
      return ok({ id: r.r.id, tripId: r.r.tripId, transactionId });
    }),
});
