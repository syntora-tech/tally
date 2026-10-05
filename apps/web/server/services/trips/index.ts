import type { DbTransaction } from '@tally/db';
import {
  account,
  allocation,
  category,
  document,
  fxRate,
  person,
  posting,
  reimbursement,
  supplierAct,
  transaction,
  trip,
  tripExpense,
  tripParticipant,
} from '@tally/db/schema';
import {
  receiptKey,
  sum,
  toDecimal,
  tripExpenseAmounts,
  tripStatus,
  tripSummary,
  type LocalDate,
} from '@tally/domain';
import { and, asc, desc, eq, inArray, lte, ne, notInArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import type { DocumentStorage } from '../../storage/types';
import { inActorScopeAtomic } from '../atomic';
import { inActorScope, type ServiceContext } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { ensureNbuRate } from '../fx';
import {
  checkbox,
  currencyCode,
  decimalString,
  localDateString,
  optionalText,
  requiredText,
} from '../fields';
import { insertDocument, uploadFile } from '../documents';
import { bookTransaction } from '../ledger';
import { reimbursementPaid } from './reimbursements';

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const USD_PEGGED = ['USD', 'USDT', 'USDC'];

/**
 * UAH per unit of `currency` on a date (5.4): NBU (fetched on a miss), else the latest stored
 * rate of any source on or before the date; null when there is none.
 */
export async function uahRateOn(
  ctx: ServiceContext,
  currency: string,
  onDate: LocalDate,
): Promise<string | null> {
  if (currency === 'UAH') return '1';
  const base = USD_PEGGED.includes(currency) ? 'USD' : currency;
  const nbu = await ensureNbuRate(ctx.db, base, onDate);
  if (nbu.isOk()) return nbu.value.rate;
  const [stored] = await inActorScope(ctx, (tx) =>
    tx
      .select({ rate: fxRate.rate })
      .from(fxRate)
      .where(and(eq(fxRate.base, base), eq(fxRate.quote, 'UAH'), lte(fxRate.onDate, onDate)))
      .orderBy(desc(fxRate.onDate))
      .limit(1),
  );
  return stored?.rate ?? null;
}

async function loadTrips(tx: DbTransaction, ids?: string[]) {
  const trips = await tx
    .select()
    .from(trip)
    .where(ids ? inArray(trip.id, ids) : undefined)
    .orderBy(sql`${trip.startsOn} desc nulls last`, asc(trip.title));
  const tripIds = trips.map((t) => t.id);
  if (tripIds.length === 0) return { trips, participants: [], expenses: [], reimbursements: [] };
  const [participants, expenses, reimbursements] = await Promise.all([
    tx
      .select({ tripId: tripParticipant.tripId, personId: person.id, name: person.fullName })
      .from(tripParticipant)
      .innerJoin(person, eq(person.id, tripParticipant.personId))
      .where(inArray(tripParticipant.tripId, tripIds))
      .orderBy(asc(person.fullName)),
    tx
      .select({ expense: tripExpense, receiptUrl: document.url, receiptKey: document.driveFileId })
      .from(tripExpense)
      .leftJoin(document, eq(document.id, tripExpense.receiptDocumentId))
      .where(inArray(tripExpense.tripId, tripIds))
      .orderBy(sql`${tripExpense.spentOn} nulls last`, asc(tripExpense.createdAt)),
    tx.select().from(reimbursement).where(inArray(reimbursement.tripId, tripIds)),
  ]);
  const paid = await reimbursementPaid(tx, reimbursements);
  return { trips, participants, expenses, reimbursements: paid };
}

function assemble(data: Awaited<ReturnType<typeof loadTrips>>, today: LocalDate) {
  return data.trips.map((t) => {
    const participants = data.participants.filter((p) => p.tripId === t.id);
    const expenses = data.expenses.filter((e) => e.expense.tripId === t.id);
    const reimbursements = data.reimbursements.filter((r) => r.tripId === t.id);
    const summary = tripSummary(
      participants.map((p) => p.personId),
      expenses.map(({ expense: e }) => ({
        ...e,
        paidBy: e.paidBy === 'company' ? ('company' as const) : ('person' as const),
      })),
      reimbursements.map((r) => ({ personId: r.personId, paidUah: r.paidUah })),
    );
    const remainingUah = sum(summary.map((p) => p.remainingUah));
    return {
      trip: t,
      participants,
      expenses,
      reimbursements,
      summary,
      status: tripStatus(
        { startsOn: t.startsOn as LocalDate | null, endsOn: t.endsOn as LocalDate | null },
        remainingUah,
        today,
      ),
    };
  });
}

/** Trips with participants, per-person totals and the derived status (6.8). */
export const listTrips = defineService({
  name: 'trips.list',
  input: z.object({}),
  handler: async (ctx) => ok(assemble(await inActorScope(ctx, (tx) => loadTrips(tx)), ctx.today)),
});

export const getTrip = defineService({
  name: 'trips.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const data = await inActorScope(ctx, async (tx) => {
      const loaded = await loadTrips(tx, [id]);
      const acts = loaded.reimbursements.length
        ? await tx
            .select({
              id: supplierAct.id,
              number: supplierAct.number,
              status: supplierAct.status,
              actDate: supplierAct.actDate,
              reimbursementId: supplierAct.reimbursementId,
            })
            .from(supplierAct)
            .where(
              inArray(
                supplierAct.reimbursementId,
                loaded.reimbursements.map((r) => r.id),
              ),
            )
        : [];
      return { loaded, acts };
    });
    const [card] = assemble(data.loaded, ctx.today);
    return card
      ? ok({ ...card, acts: data.acts })
      : err(serviceError('not_found', 'trips.notFound'));
  },
});

const participantIds = z
  .union([z.uuid(), z.array(z.uuid())])
  .optional()
  .transform((v) => [...new Set(v === undefined ? [] : Array.isArray(v) ? v : [v])]);

export const saveTripInput = z
  .object({
    id: z.preprocess(emptyToUndefined, z.uuid().optional()),
    title: requiredText('field.name'),
    location: optionalText,
    startsOn: localDateString,
    endsOn: localDateString,
    notes: optionalText,
    participantIds,
  })
  .refine((t) => t.endsOn >= t.startsOn, { message: 'trips.endBeforeStart', path: ['endsOn'] })
  .refine((t) => t.participantIds.length > 0, {
    message: 'trips.chooseParticipants',
    path: ['participantIds'],
  });

/**
 * Creates or edits a trip with its participants. A participant with expenses or reimbursements
 * cannot be removed: those rows would go with them.
 */
export const saveTrip = defineService({
  name: 'trips.save',
  input: saveTripInput,
  handler: async (ctx, { id, participantIds: people, ...values }) =>
    inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
      const [row] = id
        ? await tx.update(trip).set(values).where(eq(trip.id, id)).returning({ id: trip.id })
        : await tx.insert(trip).values(values).returning({ id: trip.id });
      if (!row) return err(serviceError('not_found', 'trips.notFound'));
      const leaving = await tx
        .select({ personId: tripParticipant.personId })
        .from(tripParticipant)
        .where(
          and(eq(tripParticipant.tripId, row.id), notInArray(tripParticipant.personId, people)),
        );
      if (leaving.length) {
        const used = await tx
          .select({ personId: tripExpense.personId })
          .from(tripExpense)
          .where(
            and(
              eq(tripExpense.tripId, row.id),
              inArray(
                tripExpense.personId,
                leaving.map((l) => l.personId),
              ),
            ),
          )
          .limit(1);
        const owed = await tx
          .select({ personId: reimbursement.personId })
          .from(reimbursement)
          .where(
            and(
              eq(reimbursement.tripId, row.id),
              inArray(
                reimbursement.personId,
                leaving.map((l) => l.personId),
              ),
            ),
          )
          .limit(1);
        if (used.length || owed.length) {
          return err(
            serviceError('conflict', 'trips.participantInUse', {
              participantIds: ['trips.participantInUse'],
            }),
          );
        }
        await tx.delete(tripParticipant).where(
          and(
            eq(tripParticipant.tripId, row.id),
            inArray(
              tripParticipant.personId,
              leaving.map((l) => l.personId),
            ),
          ),
        );
      }
      await tx
        .insert(tripParticipant)
        .values(people.map((personId) => ({ tripId: row.id, personId })))
        .onConflictDoNothing();
      return ok(row);
    }),
});

/** Title of another trip that already holds the same receipt (6.8 AC), or null. */
export async function receiptElsewhere(
  tx: DbTransaction,
  e: { tripId: string; spentOn: string; amount: string; currency: string; description: string },
): Promise<string | null> {
  const candidates = await tx
    .select({
      tripTitle: trip.title,
      spentOn: tripExpense.spentOn,
      amount: tripExpense.amount,
      currency: tripExpense.currency,
      description: tripExpense.description,
    })
    .from(tripExpense)
    .innerJoin(trip, eq(trip.id, tripExpense.tripId))
    .where(
      and(
        ne(tripExpense.tripId, e.tripId),
        eq(tripExpense.spentOn, e.spentOn),
        eq(tripExpense.currency, e.currency),
      ),
    );
  const key = receiptKey(e);
  return candidates.find((c) => receiptKey(c) === key)?.tripTitle ?? null;
}

export const tripExpenseInput = z
  .object({
    tripId: z.uuid(),
    personId: z.uuid({ error: 'trips.choosePerson' }),
    spentOn: localDateString,
    description: requiredText('field.description'),
    amount: decimalString.refine((v) => toDecimal(v).gt(0), 'field.positive'),
    currency: currencyCode,
    fxRate: z.preprocess(emptyToUndefined, decimalString.optional()),
    paidBy: z.enum(['person', 'company']).default('person'),
    reimbursable: checkbox,
    /** Company-paid: book a new Ledger expense from this account… */
    accountId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    /** …in the account's currency when it differs from the expense's. */
    accountAmount: z.preprocess(emptyToUndefined, decimalString.optional()),
    /** …or link an expense that is already in the Ledger (e.g. from a statement). */
    transactionId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    /** Record it even though the same receipt is already in another trip (6.8 AC). */
    allowDuplicate: checkbox,
    receipt: z.preprocess(
      (v) => (v instanceof File && v.size === 0 ? undefined : v),
      uploadFile.optional(),
    ),
  })
  .superRefine((e, issues) => {
    if (e.paidBy === 'company' && !e.accountId && !e.transactionId) {
      issues.addIssue({ code: 'custom', path: ['accountId'], message: 'trips.companyLedger' });
    }
  });

export type TripExpenseInput = z.input<typeof tripExpenseInput>;

/** Expense services need the document storage for receipts (6.8: `trips/{yyyy}/{trip}/receipts`). */
export function tripExpenseServices(getStorage: () => DocumentStorage) {
  const addTripExpense = defineService({
    name: 'trips.addExpense',
    input: tripExpenseInput,
    handler: async (ctx, input) => {
      const rate = input.fxRate ?? (await uahRateOn(ctx, input.currency, input.spentOn));
      const usdRate = await uahRateOn(ctx, 'USD', input.spentOn);
      if (!rate || !usdRate) {
        return err(serviceError('validation_error', 'trips.noRate', { fxRate: ['trips.noRate'] }));
      }
      const values = tripExpenseAmounts(input.amount, input.currency, rate, usdRate);
      const duplicate = input.allowDuplicate
        ? null
        : await inActorScope(ctx, (tx) => receiptElsewhere(tx, input));
      if (duplicate) {
        return err(
          serviceError('conflict', 'trips.duplicate', {
            allowDuplicate: [msg('trips.duplicateIn', { trip: duplicate })],
          }),
        );
      }
      const receipt = input.receipt
        ? await insertDocument(ctx, getStorage(), {
            type: 'receipt',
            title: input.description,
            number: null,
            docDate: input.spentOn,
            url: null,
            notes: null,
            file: input.receipt,
            links: [{ entityType: 'trip', entityId: input.tripId }],
          })
        : null;
      const company = input.paidBy === 'company';
      return inActorScopeAtomic(ctx, { dryRun: false }, async (tx) => {
        let transactionId = input.transactionId ?? null;
        if (company && !transactionId && input.accountId) {
          const [acc] = await tx.select().from(account).where(eq(account.id, input.accountId));
          if (!acc) return err(serviceError('not_found', 'ledger.accountNotFound'));
          const amount = acc.currency === input.currency ? input.amount : input.accountAmount;
          if (!amount) {
            return err(
              serviceError('validation_error', 'trips.accountAmount', {
                accountAmount: ['trips.accountAmount'],
              }),
            );
          }
          const [cat] = await tx
            .select({ id: category.id })
            .from(category)
            .where(and(eq(category.txType, 'expense'), eq(category.name, 'Travel / Conf.')));
          if (!cat) return err(serviceError('not_found', 'trips.noTravelCategory'));
          const [t] = await tx
            .select({ title: trip.title })
            .from(trip)
            .where(eq(trip.id, input.tripId));
          const booked = await bookTransaction(
            tx,
            {
              type: 'expense',
              occurredOn: input.spentOn,
              categoryId: cat.id,
              description: `${t?.title ?? ''} · ${input.description}`,
              counterparty: null,
              externalRef: null,
              personId: input.personId,
              clientId: null,
              counterpartyAddress: null,
              from: { accountId: acc.id, amount },
              to: undefined,
              fee: undefined,
            },
            { personId: input.personId, clientId: null, counterpartyAddress: null },
          );
          transactionId = booked.id;
        } else if (company && transactionId) {
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
        }
        const [row] = await tx
          .insert(tripExpense)
          .values({
            tripId: input.tripId,
            personId: input.personId,
            spentOn: input.spentOn,
            description: input.description,
            amount: input.amount,
            currency: input.currency,
            fxRate: rate,
            fxSource: input.fxRate ? 'manual' : 'nbu',
            ...values,
            paidBy: input.paidBy,
            reimbursable: company ? false : input.reimbursable,
            receiptDocumentId: receipt?.id ?? null,
            transactionId: company ? transactionId : null,
          })
          .returning({ id: tripExpense.id });
        return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
      });
    },
  });
  return { addTripExpense };
}

/** A wrong expense is removed; a Ledger expense booked for it stays (delete it in the Ledger). */
export const deleteTripExpense = defineService({
  name: 'trips.deleteExpense',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .delete(tripExpense)
        .where(eq(tripExpense.id, id))
        .returning({ tripId: tripExpense.tripId }),
    );
    return row ? ok({ id: row.tripId }) : err(serviceError('not_found', 'trips.expenseNotFound'));
  },
});

/**
 * Ledger expenses a trip can point at (e.g. statement rows entered by an agent): `Travel / Conf.`
 * from a month before the trip, with what is still unallocated and whether an expense uses it.
 */
export const tripLedgerCandidates = defineService({
  name: 'trips.ledgerCandidates',
  input: z.object({ since: localDateString }),
  handler: async (ctx, { since }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: transaction.id,
          occurredOn: transaction.occurredOn,
          description: transaction.description,
          counterparty: transaction.counterparty,
          amount: posting.amount,
          currency: posting.currency,
          accountName: account.name,
          used: sql<string>`coalesce((select sum(a.amount * coalesce(a.fx_rate, 1)) from ${allocation} a where a.transaction_id = "transaction"."id"), 0)`,
          linked: sql<boolean>`exists (select 1 from ${tripExpense} e where e.transaction_id = "transaction"."id")`,
        })
        .from(transaction)
        .innerJoin(
          posting,
          and(eq(posting.transactionId, transaction.id), eq(posting.isFee, false)),
        )
        .innerJoin(account, eq(account.id, posting.accountId))
        .innerJoin(category, eq(category.id, transaction.categoryId))
        .where(
          and(
            eq(transaction.type, 'expense'),
            eq(category.name, 'Travel / Conf.'),
            sql`${transaction.occurredOn} >= ${since}`,
          ),
        )
        .orderBy(desc(transaction.occurredOn))
        .limit(200),
    );
    return ok(
      rows.map(({ used, amount, ...r }) => ({
        ...r,
        amount: toDecimal(amount).abs().toFixed(2),
        remaining: toDecimal(amount).abs().minus(used).toFixed(2),
      })),
    );
  },
});
