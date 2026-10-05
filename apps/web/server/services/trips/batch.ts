import { transaction, trip, tripExpense, tripParticipant } from '@tally/db/schema';
import { toDecimal, tripExpenseAmounts, type LocalDate } from '@tally/domain';
import { eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { currencyCode, decimalString, localDateString, optionalText } from '../fields';
import { receiptElsewhere, uahRateOn } from '.';

const dryRun = z.boolean().default(false).describe('Validate and preview without writing');

const tripItem = z.object({
  id: z.uuid().optional().describe('Update this trip; omit to create one'),
  title: z.string().trim().min(1),
  location: optionalText,
  startsOn: localDateString,
  endsOn: localDateString,
  notes: optionalText,
  participantIds: z
    .array(z.uuid())
    .default([])
    .describe('People taking part (person ids); added to the trip, never removed here'),
});

/** Trips for agents (13.3, A-070): create or update by id; participants are only added. */
export const upsertTrips = defineService({
  name: 'trips.upsertBatch',
  input: z.object({ trips: z.array(tripItem).min(1).max(20), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; status: 'created' | 'updated' }[] = [];
      for (const [index, { id, participantIds, ...values }] of input.trips.entries()) {
        const key = `trips.${String(index)}`;
        if (values.endsOn < values.startsOn) {
          errors[key] = ['trips.endBeforeStart'];
          continue;
        }
        const [row] = id
          ? await tx.update(trip).set(values).where(eq(trip.id, id)).returning({ id: trip.id })
          : await tx.insert(trip).values(values).returning({ id: trip.id });
        if (!row) {
          errors[key] = ['trips.notFound'];
          continue;
        }
        if (participantIds.length) {
          await tx
            .insert(tripParticipant)
            .values(participantIds.map((personId) => ({ tripId: row.id, personId })))
            .onConflictDoNothing();
        }
        results.push({ index, id: row.id, status: id ? 'updated' : 'created' });
      }
      return Object.keys(errors).length
        ? err(
            serviceError(
              'validation_error',
              msg('batch.failedItems', { count: Object.keys(errors).length }),
              errors,
            ),
          )
        : ok({ results });
    }),
});

const expenseItem = z.object({
  personId: z.uuid().describe('A participant of the trip'),
  spentOn: localDateString,
  description: z.string().trim().min(1),
  amount: decimalString.refine((v) => toDecimal(v).gt(0), 'field.positive'),
  currency: currencyCode,
  fxRate: decimalString.optional().describe('UAH per unit; omit for the NBU rate on spentOn'),
  paidBy: z.enum(['person', 'company']).default('person'),
  reimbursable: z
    .boolean()
    .default(true)
    .describe('Person-paid only: whether the company returns the money'),
  transactionId: z
    .uuid()
    .optional()
    .describe('Company-paid: the Ledger expense that paid it (required for company)'),
  allowDuplicate: z
    .boolean()
    .default(false)
    .describe('Record even if the same date + amount + description is in another trip'),
});

/**
 * Trip expenses for agents (13.3): valued at NBU unless a rate is given; a company-paid expense
 * points at its Ledger expense. A receipt already in another trip is an error unless allowed.
 */
export const addTripExpenses = defineService({
  name: 'trips.addExpensesBatch',
  input: z.object({
    tripId: z.uuid(),
    expenses: z.array(expenseItem).min(1).max(200),
    dryRun,
  }),
  handler: async (ctx, input) => {
    const rates = new Map<string, string | null>();
    const rate = async (currency: string, on: LocalDate) => {
      const key = `${currency}|${on}`;
      if (!rates.has(key)) rates.set(key, await uahRateOn(ctx, currency, on));
      return rates.get(key) ?? null;
    };
    const valued: ({ uah: string; usd: string } | null)[] = [];
    for (const e of input.expenses) {
      const unit = e.fxRate ?? (await rate(e.currency, e.spentOn));
      const usd = await rate('USD', e.spentOn);
      valued.push(unit && usd ? { uah: unit, usd } : null);
    }
    return inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string }[] = [];
      for (const [index, e] of input.expenses.entries()) {
        const key = `expenses.${String(index)}`;
        const value = valued[index];
        if (!value) {
          errors[key] = ['trips.noRate'];
          continue;
        }
        if (e.paidBy === 'company') {
          const [linked] = e.transactionId
            ? await tx
                .select({ type: transaction.type })
                .from(transaction)
                .where(eq(transaction.id, e.transactionId))
            : [];
          if (linked?.type !== 'expense') {
            errors[key] = ['trips.companyLedger'];
            continue;
          }
        }
        if (!e.allowDuplicate) {
          const other = await receiptElsewhere(tx, { tripId: input.tripId, ...e });
          if (other) {
            errors[key] = [msg('trips.duplicateIn', { trip: other })];
            continue;
          }
        }
        const [row] = await tx
          .insert(tripExpense)
          .values({
            tripId: input.tripId,
            personId: e.personId,
            spentOn: e.spentOn,
            description: e.description,
            amount: e.amount,
            currency: e.currency,
            fxRate: value.uah,
            fxSource: e.fxRate ? 'manual' : 'nbu',
            ...tripExpenseAmounts(e.amount, e.currency, value.uah, value.usd),
            paidBy: e.paidBy,
            reimbursable: e.paidBy === 'company' ? false : e.reimbursable,
            transactionId: e.paidBy === 'company' ? (e.transactionId ?? null) : null,
          })
          .returning({ id: tripExpense.id });
        if (row) results.push({ index, id: row.id });
      }
      return Object.keys(errors).length
        ? err(
            serviceError(
              'validation_error',
              msg('batch.failedItems', { count: Object.keys(errors).length }),
              errors,
            ),
          )
        : ok({ results });
    });
  },
});
