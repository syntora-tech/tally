import { paymentCharge, plannedExpense } from '@tally/db/schema';
import { eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { definedOnly } from '../patch';
import {
  paymentChargeInput,
  plannedExpenseInput,
  savePaymentChargeIn,
  savePlannedExpenseIn,
} from '.';
import {
  markPlannedPaidIn,
  markPlannedPaidInput,
  setAmountInput,
  resetPlannedAmountIn,
  setPlannedAmountIn,
  skipPlannedIn,
  unlinkPlannedIn,
  unskipPlannedIn,
} from './payments';

const invalid = (error: z.ZodError) =>
  serviceError(
    'validation_error',
    'general.checkInput',
    Object.fromEntries(error.issues.map((i) => [i.path.join('.'), [i.message]])),
  );

const dryRun = z.boolean().default(false).describe('Validate and preview without writing');
const text = (description: string) => z.string().trim().nullable().optional().describe(description);
const decimal = (description: string) =>
  z.string().trim().nullable().optional().describe(description);
const month = (description: string) =>
  z.string().trim().nullable().optional().describe(description);

const feeFields = {
  feeFixed: decimal('Bank fee per transfer, fixed part, decimal string'),
  feePercent: decimal('Bank fee per transfer, percent of the amount, 0–100'),
  feeCurrency: text('Currency the bank charges the fee in; null = the payment currency'),
  feeStepFrom: decimal(
    'Tariff step: from this payment amount the fixed fee is feeStepFixed, e.g. "100000"',
  ),
  feeStepFixed: decimal(
    'Fixed fee from feeStepFrom on, e.g. "15" (PrivatBank: 5 UAH, 15 UAH from 100 000)',
  ),
};

const chargeItem = z.object({
  id: z.uuid().optional().describe('Charge id to keep and update; without it a charge is added'),
  name: z.string().describe('E.g. "ПДФО", "Військовий збір", "ЄСВ"'),
  mode: z
    .enum(['withheld', 'on_top'])
    .describe(
      'withheld = taken out of the gross (PIT, military levy); on_top = paid besides it (ЄСВ)',
    ),
  ratePercent: z.string().describe('Rate in percent, decimal string, e.g. "18"'),
  categoryId: z.uuid().describe('Expense category (from list_categories), usually Taxes'),
  currency: text('Currency of the charge; null = the payment currency'),
  counterparty: text('Who receives it, e.g. "ГУ ДПС в Одеській обл."'),
  startsOn: z.string().describe('First month, YYYY-MM or YYYY-MM-01'),
  endsOn: month('Last month (inclusive); null = open-ended'),
  ...feeFields,
});

const plannedItem = z.object({
  id: z.uuid().optional().describe('Planned expense id; without it a new one is created'),
  name: text('Name, e.g. "Director salary", "Accountant"'),
  categoryId: z.uuid().optional().describe('Expense category from list_categories'),
  amount: decimal('Amount per period (for a salary: the monthly gross), decimal string'),
  currency: text('Currency, e.g. UAH'),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  anchorMonth: z
    .number()
    .int()
    .min(1)
    .max(12)
    .nullable()
    .optional()
    .describe('First month of the cycle for quarterly and yearly'),
  dueDay: z
    .number()
    .int()
    .min(1)
    .max(31)
    .nullable()
    .optional()
    .describe('Day of month when no parts'),
  startsOn: month('First month, YYYY-MM'),
  endsOn: month(
    'Last month (inclusive); null = open-ended. Stop a plan with it instead of deleting',
  ),
  notes: text('Notes'),
  personId: z.uuid().nullable().optional().describe('Whose cost it is (e.g. the director)'),
  counterparty: text('Who receives the money'),
  ...feeFields,
  parts: z
    .array(
      z.object({
        id: z.uuid().optional(),
        name: z.string().describe('E.g. "Advance", "Rest"'),
        amount: decimal('Fixed amount; null = the rest of the amount (one part at most)'),
        dueDay: z.number().int().min(1).max(31),
        monthOffset: z
          .number()
          .int()
          .min(0)
          .max(1)
          .default(0)
          .describe('1 = paid in the next month'),
      }),
    )
    .optional()
    .describe('Replaces the instalments when sent; [] = one payment of the whole amount'),
  charges: z
    .array(chargeItem)
    .optional()
    .describe('Replaces the taxes on this expense when sent; charges with paid payments must stay'),
});

/**
 * Planned expenses for agents (A-082): created or updated with their parts and charges, matched by
 * id; only the fields sent change. All-or-nothing with dryRun.
 */
export const upsertPlannedExpenses = defineService({
  name: 'planned.upsertBatch',
  input: z.object({ items: z.array(plannedItem).min(1).max(50), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; status: 'created' | 'updated' }[] = [];
      for (const [index, item] of input.items.entries()) {
        const key = `items.${String(index)}`;
        const [current] = item.id
          ? await tx.select().from(plannedExpense).where(eq(plannedExpense.id, item.id))
          : [];
        if (item.id && !current) {
          errors[key] = ['planned.notFound'];
          continue;
        }
        const parsed = plannedExpenseInput.safeParse({ ...(current ?? {}), ...definedOnly(item) });
        if (!parsed.success) {
          errors[key] = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
          continue;
        }
        const saved = await savePlannedExpenseIn(tx, ctx.today, parsed.data);
        if (saved.isErr()) {
          errors[key] = [saved.error.message];
          continue;
        }
        results.push({ index, id: saved.value.id, status: current ? 'updated' : 'created' });
      }
      return Object.keys(errors).length
        ? err(
            serviceError(
              'validation_error',
              msg('batch.failedItems', { count: Object.keys(errors).length }),
              errors,
            ),
          )
        : ok({ items: results });
    }),
});

/** Taxes on every payout of a person (A-082), e.g. 20 % on top in UAH; stop with endsOn. */
export const upsertPayoutCharges = defineService({
  name: 'planned.payoutCharges',
  input: z.object({
    charges: z
      .array(
        chargeItem
          .omit({ mode: true })
          .partial({ name: true, ratePercent: true, categoryId: true, startsOn: true })
          .extend({ personId: z.uuid().optional().describe('Person whose payouts are taxed') }),
      )
      .min(1)
      .max(50),
    dryRun,
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; status: 'created' | 'updated' }[] = [];
      for (const [index, item] of input.charges.entries()) {
        const key = `charges.${String(index)}`;
        const [current] = item.id
          ? await tx.select().from(paymentCharge).where(eq(paymentCharge.id, item.id))
          : [];
        if ((item.id && !current) || current?.plannedExpenseId) {
          errors[key] = ['planned.chargeNotFound'];
          continue;
        }
        const parsed = paymentChargeInput.safeParse({
          ...(current ?? {}),
          ...definedOnly(item),
          mode: 'on_top',
          plannedExpenseId: null,
        });
        if (!parsed.success) {
          errors[key] = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
          continue;
        }
        const saved = await savePaymentChargeIn(tx, ctx.today, parsed.data);
        if (saved.isErr()) {
          errors[key] = [saved.error.message];
          continue;
        }
        results.push({ index, id: saved.value.id, status: current ? 'updated' : 'created' });
      }
      return Object.keys(errors).length
        ? err(
            serviceError(
              'validation_error',
              msg('batch.failedItems', { count: Object.keys(errors).length }),
              errors,
            ),
          )
        : ok({ charges: results });
    }),
});

const paymentAction = z.discriminatedUnion('action', [
  z.object({
    id: z.uuid(),
    action: z.literal('pay'),
    transactionIds: z
      .array(z.uuid())
      .max(20)
      .optional()
      .describe('Expenses already in the Ledger (e.g. statement rows) that paid it'),
    accountId: z.uuid().optional().describe('Or book a new expense from this account'),
    occurredOn: z.string().optional().describe('Date of the new expense, YYYY-MM-DD'),
    amount: z.string().optional().describe('Amount of the new expense; default the planned amount'),
    feeAmount: z.string().optional().describe('Bank fee of the new expense'),
    feeAccountId: z.uuid().optional().describe('Account the fee is charged to, if another'),
    description: z.string().optional(),
  }),
  z.object({
    id: z.uuid(),
    action: z.literal('unlink'),
    transactionIds: z.array(z.uuid()).optional().describe('Which ones; all when omitted'),
  }),
  z.object({ id: z.uuid(), action: z.literal('skip'), reason: z.string().min(1) }),
  z.object({ id: z.uuid(), action: z.literal('unskip') }),
  z.object({
    id: z.uuid(),
    action: z.literal('set_amount'),
    amount: z
      .string()
      .describe(
        'This month: the gross of a salary instalment (net and taxes follow) or the amount',
      ),
  }),
  z.object({ id: z.uuid(), action: z.literal('reset_amount') }),
]);

/** Marks planned payments paid, skipped or corrected (A-082); the owner allowed agents to do it. */
export const updatePlannedPayments = defineService({
  name: 'planned.paymentsBatch',
  input: z.object({ payments: z.array(paymentAction).min(1).max(100), dryRun }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; action: string }[] = [];
      for (const [index, p] of input.payments.entries()) {
        const result = await (async () => {
          switch (p.action) {
            case 'pay': {
              const parsed = markPlannedPaidInput.safeParse(p);
              return parsed.success
                ? markPlannedPaidIn(tx, ctx.today, parsed.data)
                : err(invalid(parsed.error));
            }
            case 'unlink':
              return unlinkPlannedIn(tx, p.id, p.transactionIds);
            case 'skip':
              return skipPlannedIn(tx, p.id, p.reason);
            case 'unskip':
              return unskipPlannedIn(tx, p.id);
            case 'set_amount': {
              const parsed = setAmountInput.safeParse(p);
              return parsed.success
                ? setPlannedAmountIn(tx, parsed.data)
                : err(invalid(parsed.error));
            }
            case 'reset_amount':
              return resetPlannedAmountIn(tx, ctx.today, p.id);
          }
        })();
        if (result.isErr()) {
          errors[`payments.${String(index)}`] = [
            result.error.message,
            ...Object.entries(result.error.fieldErrors ?? {}).flatMap(([field, messages]) =>
              messages.map((m) => `${field}: ${m}`),
            ),
          ];
        } else results.push({ index, id: p.id, action: p.action });
      }
      return Object.keys(errors).length
        ? err(
            serviceError(
              'validation_error',
              msg('batch.failedItems', { count: Object.keys(errors).length }),
              errors,
            ),
          )
        : ok({ payments: results });
    }),
});
