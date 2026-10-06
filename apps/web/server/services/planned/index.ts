import type { DbTransaction } from '@tally/db';
import {
  category,
  paymentCharge,
  person,
  plannedExpense,
  plannedExpensePart,
  plannedPayment,
} from '@tally/db/schema';
import { plannedExpenseDates, toDecimal, type LocalDate } from '@tally/domain';
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import {
  currencyCode,
  decimalString,
  monthStart,
  optionalText,
  requiredText,
  transferFeeFields,
} from '../fields';
import { syncPlannedPayments } from './sync';

/** Missing and empty form values both mean "not set". */
const emptyToNull = (v: unknown) =>
  v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v;
const optionalInt = (min: number, max: number, message: string) =>
  z.preprocess(
    emptyToNull,
    z.coerce.number({ error: message }).int(message).min(min, message).max(max, message).nullable(),
  );
const optionalId = z.preprocess(emptyToNull, z.uuid().nullable().optional());

export const plannedPartInput = z.object({
  id: optionalId,
  name: requiredText('field.name'),
  /** Empty = the rest of the expense's amount. */
  amount: z
    .preprocess(emptyToNull, decimalString.nullable().optional())
    .transform((v) => v ?? null)
    .refine((v) => v === null || toDecimal(v).gt(0), 'field.positive'),
  dueDay: z.coerce
    .number({ error: 'planned.dueDay' })
    .int()
    .min(1, 'planned.dueDay')
    .max(31, 'planned.dueDay'),
  monthOffset: z.coerce.number().int().min(0).max(1).default(0),
  sort: z.coerce.number().int().default(0),
});

const chargeFields = {
  id: optionalId,
  name: requiredText('field.name'),
  mode: z.enum(['withheld', 'on_top']).default('on_top'),
  ratePercent: decimalString.refine(
    (v) => toDecimal(v).gt(0) && toDecimal(v).lte(100),
    'planned.percentRange',
  ),
  categoryId: z.uuid({ error: 'ledger.chooseCategory' }),
  currency: z
    .preprocess(emptyToNull, currencyCode.nullable().optional())
    .transform((v) => v ?? null),
  counterparty: optionalText,
  startsOn: monthStart,
  endsOn: z.preprocess(emptyToNull, monthStart.nullable().optional()).transform((v) => v ?? null),
  ...transferFeeFields,
};

export const plannedChargeInput = z.object(chargeFields);

const endsAfterStart = (
  v: { startsOn: string; endsOn: string | null },
  issues: z.RefinementCtx,
) => {
  if (v.endsOn && v.endsOn < v.startsOn) {
    issues.addIssue({ code: 'custom', path: ['endsOn'], message: 'planned.endsBeforeStart' });
  }
};

export const plannedExpenseInput = z
  .object({
    id: optionalId,
    name: requiredText('field.name'),
    categoryId: z.uuid({ error: 'ledger.chooseCategory' }),
    amount: decimalString.refine((v) => toDecimal(v).gt(0), 'field.positive'),
    currency: currencyCode,
    frequency: z.enum(['monthly', 'quarterly', 'yearly']).default('monthly'),
    anchorMonth: optionalInt(1, 12, 'planned.anchorMonth'),
    dueDay: optionalInt(1, 31, 'planned.dueDay'),
    startsOn: monthStart,
    endsOn: z.preprocess(emptyToNull, monthStart.nullable()),
    notes: optionalText,
    personId: optionalId.transform((v) => v ?? null),
    counterparty: optionalText,
    ...transferFeeFields,
    /** When given, replaces the instalments (empty = one payment of the whole amount). */
    parts: z.array(plannedPartInput).optional(),
    /** When given, replaces the charges on this expense. */
    charges: z.array(plannedChargeInput.superRefine(endsAfterStart)).optional(),
  })
  .superRefine((v, issues) => {
    if (v.frequency !== 'monthly' && v.anchorMonth === null) {
      issues.addIssue({ code: 'custom', path: ['anchorMonth'], message: 'planned.anchorMonth' });
    }
    endsAfterStart(v, issues);
    if (v.parts && v.parts.filter((p) => p.amount === null).length > 1) {
      issues.addIssue({ code: 'custom', path: ['parts'], message: 'planned.oneRest' });
    }
  })
  .transform((v) => ({ ...v, anchorMonth: v.frequency === 'monthly' ? null : v.anchorMonth }));

/** Planned expenses with parts, charges and the next date from today (6.1, A-067, A-082). */
export const listPlannedExpenses = defineService({
  name: 'planned.list',
  input: z.object({}),
  handler: async (ctx) => {
    const { rows, parts, charges } = await inActorScope(ctx, async (tx) => ({
      rows: await tx
        .select({
          expense: plannedExpense,
          categoryName: category.name,
          personName: person.fullName,
        })
        .from(plannedExpense)
        .innerJoin(category, eq(category.id, plannedExpense.categoryId))
        .leftJoin(person, eq(person.id, plannedExpense.personId))
        .orderBy(asc(plannedExpense.name)),
      parts: await tx
        .select()
        .from(plannedExpensePart)
        .orderBy(asc(plannedExpensePart.sort), asc(plannedExpensePart.dueDay)),
      charges: await tx
        .select({ charge: paymentCharge, categoryName: category.name })
        .from(paymentCharge)
        .innerJoin(category, eq(category.id, paymentCharge.categoryId))
        .where(isNotNull(paymentCharge.plannedExpenseId))
        .orderBy(asc(paymentCharge.name)),
    }));
    return ok(
      rows.map((r) => ({
        ...r,
        parts: parts.filter((p) => p.plannedExpenseId === r.expense.id),
        charges: charges.filter((c) => c.charge.plannedExpenseId === r.expense.id),
        nextOn:
          plannedExpenseDates(
            {
              ...r.expense,
              startsOn: r.expense.startsOn as LocalDate,
              endsOn: r.expense.endsOn as LocalDate | null,
            },
            ctx.today,
            13,
          ).find((on) => on >= ctx.today) ?? null,
      })),
    );
  },
});

/**
 * Removes the payments of parts or charges about to go (A-082). Paid ones are money on record, so
 * the part or charge then stays and should be stopped instead.
 */
async function dropPaymentsOf(
  tx: DbTransaction,
  column: typeof plannedPayment.partId | typeof plannedPayment.chargeId,
  ids: readonly string[],
) {
  if (ids.length === 0) return ok(null);
  const paid = await tx
    .select({ id: plannedPayment.id })
    .from(plannedPayment)
    .where(and(inArray(column, [...ids]), eq(plannedPayment.status, 'paid')))
    .limit(1);
  if (paid.length) {
    return err(
      serviceError(
        'conflict',
        column === plannedPayment.partId ? 'planned.partHasPaid' : 'planned.chargeHasPaid',
      ),
    );
  }
  await tx
    .delete(plannedPayment)
    .where(and(inArray(column, [...ids]), isNotNull(plannedPayment.parentId)));
  await tx.delete(plannedPayment).where(inArray(column, [...ids]));
  return ok(null);
}

type PartInput = z.output<typeof plannedPartInput>;
type ChargeInput = z.output<typeof plannedChargeInput>;

async function replaceParts(tx: DbTransaction, expenseId: string, parts: readonly PartInput[]) {
  const keep = parts.flatMap((p) => (p.id ? [p.id] : []));
  const gone = await tx
    .select({ id: plannedExpensePart.id })
    .from(plannedExpensePart)
    .where(
      and(
        eq(plannedExpensePart.plannedExpenseId, expenseId),
        keep.length ? notInArray(plannedExpensePart.id, keep) : undefined,
      ),
    );
  const dropped = await dropPaymentsOf(
    tx,
    plannedPayment.partId,
    gone.map((g) => g.id),
  );
  if (dropped.isErr()) return dropped;
  if (gone.length) {
    await tx.delete(plannedExpensePart).where(
      inArray(
        plannedExpensePart.id,
        gone.map((g) => g.id),
      ),
    );
  }
  // Free the single "rest" slot before an existing part becomes the rest.
  for (const { id, ...values } of parts) {
    if (id && values.amount !== null) {
      await tx
        .update(plannedExpensePart)
        .set(values)
        .where(
          and(eq(plannedExpensePart.id, id), eq(plannedExpensePart.plannedExpenseId, expenseId)),
        );
    }
  }
  for (const { id, ...values } of parts) {
    if (id && values.amount === null) {
      await tx
        .update(plannedExpensePart)
        .set(values)
        .where(
          and(eq(plannedExpensePart.id, id), eq(plannedExpensePart.plannedExpenseId, expenseId)),
        );
    } else if (!id) {
      await tx.insert(plannedExpensePart).values({ ...values, plannedExpenseId: expenseId });
    }
  }
  return ok(null);
}

async function replaceCharges(
  tx: DbTransaction,
  expenseId: string,
  charges: readonly ChargeInput[],
) {
  const keep = charges.flatMap((c) => (c.id ? [c.id] : []));
  const gone = await tx
    .select({ id: paymentCharge.id })
    .from(paymentCharge)
    .where(
      and(
        eq(paymentCharge.plannedExpenseId, expenseId),
        keep.length ? notInArray(paymentCharge.id, keep) : undefined,
      ),
    );
  const dropped = await dropPaymentsOf(
    tx,
    plannedPayment.chargeId,
    gone.map((g) => g.id),
  );
  if (dropped.isErr()) return dropped;
  if (gone.length) {
    await tx.delete(paymentCharge).where(
      inArray(
        paymentCharge.id,
        gone.map((g) => g.id),
      ),
    );
  }
  for (const { id, ...values } of charges) {
    if (id) {
      await tx
        .update(paymentCharge)
        .set(values)
        .where(and(eq(paymentCharge.id, id), eq(paymentCharge.plannedExpenseId, expenseId)));
    } else {
      await tx.insert(paymentCharge).values({ ...values, plannedExpenseId: expenseId });
    }
  }
  return ok(null);
}

export async function savePlannedExpenseIn(
  tx: DbTransaction,
  today: LocalDate,
  { id, parts, charges, ...values }: z.output<typeof plannedExpenseInput>,
) {
  const [row] = id
    ? await tx
        .update(plannedExpense)
        .set(values)
        .where(eq(plannedExpense.id, id))
        .returning({ id: plannedExpense.id })
    : await tx.insert(plannedExpense).values(values).returning({ id: plannedExpense.id });
  if (!row) return err(serviceError('not_found', 'planned.notFound'));
  if (parts) {
    const replaced = await replaceParts(tx, row.id, parts);
    if (replaced.isErr()) return err(replaced.error);
  }
  if (charges) {
    const replaced = await replaceCharges(tx, row.id, charges);
    if (replaced.isErr()) return err(replaced.error);
  }
  await syncPlannedPayments(tx, today, [row.id]);
  return ok(row);
}

export const savePlannedExpense = defineService({
  name: 'planned.save',
  input: plannedExpenseInput,
  handler: async (ctx, input) =>
    inActorScope(ctx, (tx) => savePlannedExpenseIn(tx, ctx.today, input)),
});

/**
 * A plan may go together with its unpaid payments; once something was paid, stopping it with
 * `endsOn` keeps the record of the money (A-082).
 */
export const deletePlannedExpense = defineService({
  name: 'planned.delete',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const paid = await tx
        .select({ id: plannedPayment.id })
        .from(plannedPayment)
        .where(and(eq(plannedPayment.plannedExpenseId, id), eq(plannedPayment.status, 'paid')))
        .limit(1);
      if (paid.length) return err(serviceError('conflict', 'planned.hasPaid'));
      await tx
        .delete(plannedPayment)
        .where(and(eq(plannedPayment.plannedExpenseId, id), isNotNull(plannedPayment.parentId)));
      await tx.delete(plannedPayment).where(eq(plannedPayment.plannedExpenseId, id));
      const [row] = await tx
        .delete(plannedExpense)
        .where(eq(plannedExpense.id, id))
        .returning({ id: plannedExpense.id });
      return row ? ok(row) : err(serviceError('not_found', 'planned.notFound'));
    }),
});

/** One instalment of a planned expense (A-082), edited on its own in the UI. */
export const savePlannedPart = defineService({
  name: 'planned.parts.save',
  input: plannedPartInput.extend({ plannedExpenseId: z.uuid() }),
  handler: async (ctx, { id, plannedExpenseId, ...values }) =>
    inActorScope(ctx, async (tx) => {
      if (values.amount === null) {
        const rest = await tx
          .select({ id: plannedExpensePart.id })
          .from(plannedExpensePart)
          .where(
            and(
              eq(plannedExpensePart.plannedExpenseId, plannedExpenseId),
              isNull(plannedExpensePart.amount),
              id ? ne(plannedExpensePart.id, id) : undefined,
            ),
          );
        if (rest.length) return err(serviceError('validation_error', 'planned.oneRest'));
      }
      const [row] = id
        ? await tx
            .update(plannedExpensePart)
            .set(values)
            .where(
              and(
                eq(plannedExpensePart.id, id),
                eq(plannedExpensePart.plannedExpenseId, plannedExpenseId),
              ),
            )
            .returning({ id: plannedExpensePart.id })
        : await tx
            .insert(plannedExpensePart)
            .values({ ...values, plannedExpenseId })
            .returning({ id: plannedExpensePart.id });
      if (!row) return err(serviceError('not_found', 'planned.notFound'));
      await syncPlannedPayments(tx, ctx.today, [plannedExpenseId]);
      return ok(row);
    }),
});

export const deletePlannedPart = defineService({
  name: 'planned.parts.delete',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const dropped = await dropPaymentsOf(tx, plannedPayment.partId, [id]);
      if (dropped.isErr()) return err(dropped.error);
      const [row] = await tx
        .delete(plannedExpensePart)
        .where(eq(plannedExpensePart.id, id))
        .returning({ id: plannedExpensePart.id, expenseId: plannedExpensePart.plannedExpenseId });
      if (!row) return err(serviceError('not_found', 'planned.notFound'));
      await syncPlannedPayments(tx, ctx.today, [row.expenseId]);
      return ok({ id: row.id });
    }),
});

/**
 * A charge on a planned expense or on every payout of a person (A-082): withheld charges exist
 * only on planned expenses, since only they have a gross amount.
 */
export const savePaymentCharge = defineService({
  name: 'planned.charges.save',
  input: plannedChargeInput
    .extend({ plannedExpenseId: optionalId, personId: optionalId })
    .superRefine((v, issues) => {
      endsAfterStart(v, issues);
      if (Boolean(v.plannedExpenseId) === Boolean(v.personId)) {
        issues.addIssue({ code: 'custom', path: ['personId'], message: 'planned.chargeTarget' });
      }
      if (v.personId && v.mode === 'withheld') {
        issues.addIssue({ code: 'custom', path: ['mode'], message: 'planned.withheldOnPlanned' });
      }
    }),
  handler: async (ctx, { id, plannedExpenseId, personId, ...values }) =>
    inActorScope(ctx, async (tx) => {
      const target = {
        plannedExpenseId: plannedExpenseId ?? null,
        personId: personId ?? null,
      };
      const [row] = id
        ? await tx
            .update(paymentCharge)
            .set({ ...values, ...target })
            .where(eq(paymentCharge.id, id))
            .returning({ id: paymentCharge.id })
        : await tx
            .insert(paymentCharge)
            .values({ ...values, ...target })
            .returning({ id: paymentCharge.id });
      if (!row) return err(serviceError('not_found', 'planned.chargeNotFound'));
      if (target.plannedExpenseId) {
        await syncPlannedPayments(tx, ctx.today, [target.plannedExpenseId]);
      }
      return ok(row);
    }),
});

export const deletePaymentCharge = defineService({
  name: 'planned.charges.delete',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const dropped = await dropPaymentsOf(tx, plannedPayment.chargeId, [id]);
      if (dropped.isErr()) return err(dropped.error);
      const [row] = await tx
        .delete(paymentCharge)
        .where(eq(paymentCharge.id, id))
        .returning({ id: paymentCharge.id, expenseId: paymentCharge.plannedExpenseId });
      if (!row) return err(serviceError('not_found', 'planned.chargeNotFound'));
      if (row.expenseId) await syncPlannedPayments(tx, ctx.today, [row.expenseId]);
      return ok({ id: row.id });
    }),
});

/** Charges on the payouts of the given people (A-082), newest first. */
export const listPersonCharges = defineService({
  name: 'planned.charges.person',
  input: z.object({ personIds: z.array(z.uuid()).optional() }),
  handler: async (ctx, { personIds }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({ charge: paymentCharge, categoryName: category.name, personName: person.fullName })
        .from(paymentCharge)
        .innerJoin(category, eq(category.id, paymentCharge.categoryId))
        .innerJoin(person, eq(person.id, paymentCharge.personId))
        .where(
          personIds?.length
            ? inArray(paymentCharge.personId, personIds)
            : isNotNull(paymentCharge.personId),
        )
        .orderBy(asc(person.fullName), asc(paymentCharge.startsOn)),
    );
    return ok(rows);
  },
});
