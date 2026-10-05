import { category, plannedExpense } from '@tally/db/schema';
import { plannedExpenseDates, toDecimal, type LocalDate } from '@tally/domain';
import { asc, eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { currencyCode, decimalString, monthStart, optionalText, requiredText } from '../fields';

/** Missing and empty form values both mean "not set". */
const emptyToNull = (v: unknown) =>
  v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v;
const optionalInt = (min: number, max: number, message: string) =>
  z.preprocess(
    emptyToNull,
    z.coerce.number({ error: message }).int(message).min(min, message).max(max, message).nullable(),
  );

export const plannedExpenseInput = z
  .object({
    id: z.preprocess(emptyToNull, z.uuid().nullable().optional()),
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
  })
  .superRefine((v, issues) => {
    if (v.frequency !== 'monthly' && v.anchorMonth === null) {
      issues.addIssue({ code: 'custom', path: ['anchorMonth'], message: 'planned.anchorMonth' });
    }
    if (v.endsOn && v.endsOn < v.startsOn) {
      issues.addIssue({ code: 'custom', path: ['endsOn'], message: 'planned.endsBeforeStart' });
    }
  })
  .transform((v) => ({ ...v, anchorMonth: v.frequency === 'monthly' ? null : v.anchorMonth }));

/** Planned recurring expenses with their next date from today (6.1, A-067). */
export const listPlannedExpenses = defineService({
  name: 'planned.list',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({ expense: plannedExpense, categoryName: category.name })
        .from(plannedExpense)
        .innerJoin(category, eq(category.id, plannedExpense.categoryId))
        .orderBy(asc(plannedExpense.name)),
    );
    return ok(
      rows.map((r) => ({
        ...r,
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

export const savePlannedExpense = defineService({
  name: 'planned.save',
  input: plannedExpenseInput,
  handler: async (ctx, { id, ...values }) =>
    inActorScope(ctx, async (tx) => {
      const [row] = id
        ? await tx
            .update(plannedExpense)
            .set(values)
            .where(eq(plannedExpense.id, id))
            .returning({ id: plannedExpense.id })
        : await tx.insert(plannedExpense).values(values).returning({ id: plannedExpense.id });
      return row ? ok(row) : err(serviceError('not_found', 'planned.notFound'));
    }),
});

/** A plan is not a financial record, so it may go; stopping it with `endsOn` keeps the history. */
export const deletePlannedExpense = defineService({
  name: 'planned.delete',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .delete(plannedExpense)
        .where(eq(plannedExpense.id, id))
        .returning({ id: plannedExpense.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'planned.notFound'));
  },
});
