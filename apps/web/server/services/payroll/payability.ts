import type { Db } from '@tally/db';
import { invoice, invoiceLine, payrollItem, payrollLine, payTerms, period } from '@tally/db/schema';
import { effectiveVersion, resolvePayability, type LocalDate } from '@tally/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { withSystem } from '../../db/with-user';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { requiredText } from '../fields';
import { loadCalendar } from '../periods';

/**
 * Releases lines waiting for a client once the payout deadline has come (5.3). Full payments are
 * released by the database at allocation time; this covers the date-driven part and runs from the
 * `payability` cron, the payroll page and tests with `APP_TODAY`.
 */
export async function refreshPayability(db: Db, today: LocalDate) {
  return withSystem(db, 'system:payability', async (tx) => {
    const waiting = await tx
      .select({
        line: payrollLine,
        month: period.month,
        total: invoice.total,
        paidAmount: invoice.paidAmount,
        dueDate: invoice.dueDate,
      })
      .from(payrollLine)
      .innerJoin(payrollItem, eq(payrollItem.id, payrollLine.payrollItemId))
      .innerJoin(period, eq(period.id, payrollItem.periodId))
      .leftJoin(invoiceLine, eq(invoiceLine.id, payrollLine.fundedByInvoiceLineId))
      .leftJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
      .where(inArray(payrollLine.status, ['accrued', 'awaiting_client']));
    if (waiting.length === 0) return { released: 0 };

    const terms = await tx
      .select()
      .from(payTerms)
      .where(
        inArray(
          payTerms.assignmentId,
          waiting.map((w) => w.line.assignmentId),
        ),
      );
    const cal = await loadCalendar(tx);
    const touched = new Set<string>();
    let released = 0;
    for (const w of waiting) {
      const version = effectiveVersion(
        terms
          .filter((t) => t.assignmentId === w.line.assignmentId)
          .map((t) => ({ ...t, validFrom: t.validFrom as LocalDate })),
        w.month as LocalDate,
      );
      const state = resolvePayability(
        w.total !== null && w.paidAmount !== null && w.dueDate !== null
          ? { total: w.total, paidAmount: w.paidAmount, dueDate: w.dueDate as LocalDate }
          : null,
        {
          releasePolicy: version?.releasePolicy ?? 'on_payment_or_due',
          graceDays: version?.graceDays ?? 0,
        },
        today,
        cal,
      );
      if (!state.payable) continue;
      await tx
        .update(payrollLine)
        .set({ status: 'payable', fundingSource: state.funding, payableAt: new Date() })
        .where(
          and(
            eq(payrollLine.id, w.line.id),
            inArray(payrollLine.status, ['accrued', 'awaiting_client']),
          ),
        );
      touched.add(w.line.payrollItemId);
      released++;
    }
    for (const item of touched) {
      await tx.execute(sql`select public.refresh_payroll_item(${item})`);
    }
    return { released };
  });
}

/** Owner releases a waiting line early at the company's expense, with a reason (5.3). */
export const overridePayable = defineService({
  name: 'payroll.overridePayable',
  input: z.object({ lineId: z.uuid(), reason: requiredText('field.reason') }),
  handler: async (ctx, { lineId, reason }) => {
    if (ctx.actor.kind !== 'user' || ctx.actor.role !== 'owner') {
      return err(serviceError('forbidden', 'payroll.overrideOwnerOnly'));
    }
    const row = await inActorScope(ctx, async (tx) => {
      const [line] = await tx
        .update(payrollLine)
        .set({
          status: 'payable',
          fundingSource: 'company',
          payableAt: new Date(),
          overrideReason: reason,
        })
        .where(
          and(
            eq(payrollLine.id, lineId),
            inArray(payrollLine.status, ['accrued', 'awaiting_client']),
          ),
        )
        .returning({ id: payrollLine.id, itemId: payrollLine.payrollItemId });
      if (line) await tx.execute(sql`select public.refresh_payroll_item(${line.itemId})`);
      return line;
    });
    return row ? ok(row) : err(serviceError('conflict', 'payroll.alreadyPayable'));
  },
});
