import { adjustment, payrollItem, period, person } from '@tally/db/schema';
import { payrollPlan, toDecimal, type LocalDate } from '@tally/domain';
import { and, eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { PAYOUT_METHODS } from '../assignments/schema';
import { inActorScopeAtomic } from '../atomic';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { currencyCode, decimalString, requiredText } from '../fields';
import { ensureNbuRate } from '../fx';
import { loadCalendar } from '../periods/data';
import { createPayroll } from '../periods/payroll';
import { insertClosedAdjustment } from './lines';

/**
 * An adjustment of a closed month for a person (A-141). A person with a payout of that method
 * gets it as on the payout card (A-099, A-142); a person with none gets a new payout built from it the
 * way the close builds one — payee, payout rate, draft act. Owner only, with a reason.
 */
export const adjustClosedPerson = defineService({
  name: 'payroll.adjustClosedPerson',
  input: z.object({
    periodId: z.uuid().describe('Closed period id'),
    personId: z.uuid({ error: 'field.person' }).describe('Person id from search_people'),
    payoutMethod: z.enum(PAYOUT_METHODS).default('fiat'),
    kind: z
      .enum(['bonus', 'deduction', 'correction', 'other'])
      .default('correction')
      .describe('correction by default; deduction makes the amount negative'),
    amount: decimalString
      .refine((v) => !toDecimal(v).isZero(), 'field.nonZero')
      .describe('Signed decimal; a new payout needs a positive one'),
    currency: currencyCode
      .refine((c) => ['USD', 'USDT', 'USDC', 'UAH'].includes(c), 'periods.adjustmentCurrency')
      .default('USD'),
    reason: requiredText('field.reason').describe('Why the month changes after the close'),
    dryRun: z.boolean().default(false),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
      return err(serviceError('forbidden', 'general.forbidden'));
    }
    // Fetched before the transaction like the close, so a slow NBU answer holds no lock (A-076).
    const nbu =
      input.payoutMethod === 'fiat' && input.currency !== 'UAH'
        ? await ensureNbuRate(ctx.db, 'USD', ctx.today)
        : null;
    const payoutRate = nbu?.isOk() ? nbu.value.rate : null;
    return inActorScopeAtomic(ctx, input, async (tx) => {
      const [month] = await tx
        .select()
        .from(period)
        .where(eq(period.id, input.periodId))
        .for('update');
      if (!month) return err(serviceError('not_found', 'periods.notFound'));
      if (month.status !== 'closed') {
        return err(serviceError('conflict', 'payroll.adjustOpenPeriod'));
      }
      const [existing] = await tx
        .select({ id: payrollItem.id })
        .from(payrollItem)
        .where(
          and(
            eq(payrollItem.periodId, month.id),
            eq(payrollItem.personId, input.personId),
            eq(payrollItem.payoutMethod, input.payoutMethod),
            eq(payrollItem.kind, 'person'),
          ),
        );
      if (existing) {
        const [item] = await tx
          .select()
          .from(payrollItem)
          .where(eq(payrollItem.id, existing.id))
          .for('update');
        if (!item) return err(serviceError('not_found', 'payroll.notFound'));
        const added = await insertClosedAdjustment(tx, item, input);
        return added.map((r) => ({ ...r, created: false }));
      }

      const [who] = await tx
        .select({ id: person.id })
        .from(person)
        .where(eq(person.id, input.personId));
      if (!who) return err(serviceError('not_found', 'people.notFound'));
      const amount =
        input.kind === 'deduction' ? toDecimal(input.amount).abs().neg().toString() : input.amount;
      if (toDecimal(amount).isNegative()) {
        return err(
          serviceError('validation_error', 'payroll.adjustNewNegative', {
            amount: ['payroll.adjustNewNegative'],
          }),
        );
      }
      await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);
      const [added] = await tx
        .insert(adjustment)
        .values({
          periodId: month.id,
          personId: input.personId,
          payoutMethod: input.payoutMethod,
          kind: input.kind,
          amount,
          currency: input.currency,
          reason: input.reason,
        })
        .returning({ id: adjustment.id });
      const plan = payrollPlan(
        month.month as LocalDate,
        month.workHours,
        month.referenceFxUsdUah,
        [],
        [
          {
            personId: input.personId,
            payoutMethod: input.payoutMethod,
            amount,
            currency: input.currency,
          },
        ],
      );
      await createPayroll(tx, {
        periodId: month.id,
        plan,
        agency: [],
        assignments: [],
        timesheetIds: new Map(),
        today: ctx.today,
        cal: await loadCalendar(tx),
        payoutRate,
      });
      const [item] = await tx
        .select()
        .from(payrollItem)
        .where(
          and(
            eq(payrollItem.periodId, month.id),
            eq(payrollItem.personId, input.personId),
            eq(payrollItem.payoutMethod, input.payoutMethod),
            eq(payrollItem.kind, 'person'),
          ),
        );
      if (!item) return err(serviceError('internal_error', 'general.createFailed'));
      return ok({
        dryRun: input.dryRun,
        adjustmentId: added?.id ?? null,
        itemId: item.id,
        itemDeleted: false,
        totalUsd: item.totalUsd,
        totalUah: item.totalUah,
        created: true,
      });
    });
  },
});
