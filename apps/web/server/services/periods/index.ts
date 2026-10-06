import {
  client,
  invoice,
  adjustment,
  payrollItem,
  period,
  person,
  supplierAct,
  timesheet,
} from '@tally/db/schema';
import { agencyPlan, payrollPlan, periodPreview, toDecimal } from '@tally/domain';
import { PAYOUT_METHODS } from '../assignments/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope, type ServiceContext } from '../context';
import { defineService } from '../define-service';
import { serviceError, msg } from '../errors';
import {
  currencyCode,
  decimalString,
  monthStart,
  nonNegativeDecimal,
  optionalDecimal,
  requiredText,
} from '../fields';
import { ensureNbuRate } from '../fx';
import {
  frozenAdjustments,
  frozenHours,
  periodOf,
  periodOfAdjustment,
  refreshEarlyActs,
  refreshEarlyInvoices,
} from './early';
import { createPayroll, dropPayroll, loadAdjustments, toPlanAdjustments } from './payroll';
import {
  clientLabel,
  invoiceGroups,
  invoiceKey,
  loadCalendar,
  loadPeriodData,
  writeDraftInvoice,
} from './data';

export { loadCalendar };
export { draftEarlyAct, draftEarlyInvoice, periodDocuments } from './early';

export const listPeriods = defineService({
  name: 'periods.list',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          period,
          hoursRows: sql<number>`(select count(*)::int from ${timesheet} t where t.period_id = ${period.id})`,
          invoices: sql<number>`(select count(*)::int from ${invoice} i where i.period_id = ${period.id})`,
        })
        .from(period)
        .orderBy(desc(period.month)),
    );
    return ok(rows);
  },
});

/** Step 1 (6.4): the norm defaults to working days × 8 from WorkCalendar and stays editable. */
export const openPeriod = defineService({
  name: 'periods.open',
  input: z.object({
    month: monthStart,
    workHours: optionalDecimal,
    referenceFxUsdUah: optionalDecimal,
  }),
  handler: async (ctx, { month, workHours, referenceFxUsdUah }) => {
    const created = await inActorScope(ctx, async (tx) => {
      const norm = workHours ?? String((await loadCalendar(tx)).workHoursInMonth(month));
      const [row] = await tx
        .insert(period)
        .values({ month, workHours: norm, referenceFxUsdUah })
        .returning({ id: period.id });
      return row;
    });
    return created ? ok(created) : err(serviceError('internal_error', 'periods.openFailed'));
  },
});

export const updatePeriod = defineService({
  name: 'periods.update',
  input: z.object({
    periodId: z.uuid(),
    workHours: nonNegativeDecimal,
    referenceFxUsdUah: optionalDecimal,
  }),
  handler: async (ctx, { periodId, ...values }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(period)
        .set(values)
        .where(and(eq(period.id, periodId), eq(period.status, 'open')))
        .returning({ id: period.id }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'periods.closedOrMissing'));
  },
});

/** Wizard overview and the MCP `get_period_overview` read model (13.3). */
export const getPeriodOverview = defineService({
  name: 'periods.overview',
  input: z.object({ periodId: z.uuid() }),
  handler: async (ctx, { periodId }) => {
    const data = await inActorScope(ctx, async (tx) => {
      const [p] = await tx.select().from(period).where(eq(period.id, periodId));
      if (!p) return null;
      const { month, assignments } = await loadPeriodData(tx, p);
      const invoices = await tx
        .select({
          id: invoice.id,
          status: invoice.status,
          number: invoice.number,
          total: invoice.total,
          currency: invoice.currency,
          clientName: clientLabel,
          issueDate: invoice.issueDate,
        })
        .from(invoice)
        .innerJoin(client, eq(client.id, invoice.clientId))
        .where(eq(invoice.periodId, periodId))
        .orderBy(clientLabel);
      const adjustments = await loadAdjustments(tx, periodId);
      const payroll = await tx
        .select({ item: payrollItem, personName: person.fullName })
        .from(payrollItem)
        .leftJoin(person, eq(person.id, payrollItem.personId))
        .where(eq(payrollItem.periodId, periodId))
        .orderBy(person.fullName);
      return {
        period: p,
        assignments,
        preview: periodPreview(month, p.workHours, p.referenceFxUsdUah, assignments),
        plan: payrollPlan(
          month,
          p.workHours,
          p.referenceFxUsdUah,
          assignments,
          toPlanAdjustments(adjustments),
        ),
        adjustments,
        payroll,
        invoices,
      };
    });
    return data ? ok(data) : err(serviceError('not_found', 'periods.notFound'));
  },
});

const hoursValue = nonNegativeDecimal.refine((v) => toDecimal(v).lte(744), 'periods.maxHours');

export const hoursEntry = z.object({
  assignmentId: z.uuid(),
  /** Hours billed to the client. */
  hours: hoursValue,
  /** Hours paid to the person; omitted keeps the stored value, null or "" = same as `hours`. */
  payHours: z.preprocess((v) => (v === '' ? null : v), hoursValue.nullable()).optional(),
  /** Project of the month; omitted keeps the stored note, an empty string clears it. */
  note: z.string().trim().max(200).optional(),
});

async function writeHours(
  ctx: ServiceContext,
  periodId: string,
  entries: readonly z.output<typeof hoursEntry>[],
  source: 'manual' | 'import',
) {
  return inActorScope(ctx, async (tx) => {
    const p = await periodOf(tx, periodId);
    if (!p) return err(serviceError('not_found', 'periods.notFound'));
    const frozen = p.status === 'open' ? await frozenHours(tx, p, entries) : null;
    if (frozen) return err(serviceError('conflict', frozen));
    for (const e of entries) {
      const note = e.note === undefined ? {} : { note: e.note || null };
      // Person hours equal to the billed ones are stored as null: "the same" (A-074).
      const payHours =
        e.payHours === undefined
          ? {}
          : {
              payHours:
                e.payHours === null || toDecimal(e.payHours).eq(toDecimal(e.hours))
                  ? null
                  : e.payHours,
            };
      await tx
        .insert(timesheet)
        .values({
          periodId,
          assignmentId: e.assignmentId,
          hours: e.hours,
          source,
          ...note,
          ...payHours,
        })
        .onConflictDoUpdate({
          target: [timesheet.assignmentId, timesheet.periodId],
          set: { hours: e.hours, source, ...note, ...payHours },
        });
    }
    if (p.status === 'open') {
      const refreshed = await refreshEarlyInvoices(tx, p);
      if (refreshed.isErr()) return err(refreshed.error);
      await refreshEarlyActs(tx, p);
    }
    return ok({ id: periodId });
  });
}

/** Step 2: inline hours; closed periods are rejected by I6 (TL030). */
export const setHours = defineService({
  name: 'periods.setHours',
  input: hoursEntry.extend({ periodId: z.uuid() }),
  handler: (ctx, { periodId, ...entry }) => writeHours(ctx, periodId, [entry], 'manual'),
});

export const importHours = defineService({
  name: 'periods.importHours',
  input: z.object({ periodId: z.uuid(), rows: z.array(hoursEntry).min(1).max(500) }),
  handler: async (ctx, { periodId, rows }) => {
    const written = await writeHours(ctx, periodId, rows, 'import');
    return written.map((r) => ({ ...r, count: rows.length }));
  },
});

/**
 * Step 5: closes the month and (re)creates draft invoices — one per contract × period with a line
 * per assignment that has hours (5.1). Issued invoices of the period are never touched.
 */
export const closePeriod = defineService({
  name: 'periods.close',
  input: z.object({ periodId: z.uuid() }),
  handler: async (ctx, { periodId }) => {
    // Fetched before the transaction so a slow NBU answer never holds the period lock (A-076).
    const nbu = await ensureNbuRate(ctx.db, 'USD', ctx.today);
    const payoutRate = nbu.isOk() ? nbu.value.rate : null;
    const result = await inActorScope(ctx, async (tx) => {
      const [p] = await tx.select().from(period).where(eq(period.id, periodId)).for('update');
      if (!p) return err(serviceError('not_found', 'periods.notFound'));
      if (p.status === 'closed') return err(serviceError('conflict', 'periods.alreadyClosed'));
      const { month, assignments, timesheetIds, annexIds } = await loadPeriodData(tx, p);
      const cal = await loadCalendar(tx);

      await tx
        .delete(invoice)
        .where(and(eq(invoice.periodId, periodId), eq(invoice.status, 'draft')));
      const issued = await tx
        .select({ contractId: invoice.contractId, annexId: invoice.annexId })
        .from(invoice)
        .where(eq(invoice.periodId, periodId));
      const skip = new Set(issued.map((i) => invoiceKey(i.contractId, i.annexId)));
      const { groups, annexes } = await invoiceGroups(
        tx,
        month,
        p.workHours,
        assignments,
        annexIds,
      );

      let created = 0;
      for (const group of groups.values()) {
        if (skip.has(group.key)) continue;
        const written = await writeDraftInvoice(tx, {
          periodId,
          month,
          cal,
          group,
          annexes,
          timesheetIds,
        });
        if (written.isErr()) return err(written.error);
        if (written.value) created++;
      }

      const adjustments = toPlanAdjustments(await loadAdjustments(tx, periodId));
      const payrollItems = await createPayroll(tx, {
        periodId,
        plan: payrollPlan(month, p.workHours, p.referenceFxUsdUah, assignments, adjustments),
        agency: agencyPlan(month, assignments),
        assignments,
        timesheetIds,
        today: ctx.today,
        cal,
        payoutRate,
      });

      const closedBy = ctx.actor.kind === 'user' ? ctx.actor.userId : null;
      await tx
        .update(period)
        .set({ status: 'closed', closedAt: new Date(), closedBy })
        .where(eq(period.id, periodId));
      return ok({ id: periodId, draftInvoices: created, payrollItems });
    });
    return result;
  },
});

/** Owner-only, with a reason recorded in audit_log (I6, A-041). */
export const reopenPeriod = defineService({
  name: 'periods.reopen',
  input: z.object({ periodId: z.uuid(), reason: requiredText('field.reason') }),
  handler: async (ctx, { periodId, reason }) =>
    inActorScope(ctx, async (tx) => {
      const locked = await tx
        .select({ number: supplierAct.number })
        .from(supplierAct)
        .innerJoin(payrollItem, eq(payrollItem.id, supplierAct.payrollItemId))
        .where(and(eq(payrollItem.periodId, periodId), ne(supplierAct.status, 'draft')))
        .limit(1);
      if (locked[0]) {
        return err(
          serviceError('conflict', msg('periods.actIssued', { number: locked[0].number ?? '' })),
        );
      }
      await tx.execute(sql`select set_config('app.reason', ${reason}, true)`);
      const [row] = await tx
        .update(period)
        .set({ status: 'open', closedAt: null, closedBy: null })
        .where(and(eq(period.id, periodId), eq(period.status, 'closed')))
        .returning({ id: period.id });
      if (!row) return err(serviceError('conflict', 'periods.notClosed'));
      await dropPayroll(tx, periodId);
      return ok(row);
    }),
});

/** Step 4 (6.4): bonus, deduction or compensation with a reason; closed periods refuse it (I6). */
export const addAdjustment = defineService({
  name: 'periods.addAdjustment',
  input: z.object({
    periodId: z.uuid(),
    personId: z.uuid({ error: 'field.person' }),
    payoutMethod: z.enum(PAYOUT_METHODS).default('fiat'),
    kind: z.enum(['bonus', 'deduction', 'trip_reimbursement', 'correction', 'other']),
    amount: decimalString.refine((v) => !toDecimal(v).isZero(), 'field.nonZero'),
    currency: currencyCode.refine(
      (c) => ['USD', 'USDT', 'USDC', 'UAH'].includes(c),
      'periods.adjustmentCurrency',
    ),
    reason: requiredText('field.reason'),
  }),
  handler: async (ctx, input) => {
    const amount =
      input.kind === 'deduction' ? toDecimal(input.amount).abs().neg().toString() : input.amount;
    return inActorScope(ctx, async (tx) => {
      const p = await periodOf(tx, input.periodId);
      if (!p) return err(serviceError('not_found', 'periods.notFound'));
      const frozen =
        p.status === 'open' && input.payoutMethod === 'fiat'
          ? await frozenAdjustments(tx, p, input.personId)
          : null;
      if (frozen) return err(serviceError('conflict', frozen));
      const [row] = await tx
        .insert(adjustment)
        .values({ ...input, amount })
        .returning({ id: adjustment.id });
      if (!row) return err(serviceError('forbidden', 'general.forbidden'));
      if (p.status === 'open') await refreshEarlyActs(tx, p);
      return ok(row);
    });
  },
});

export const removeAdjustment = defineService({
  name: 'periods.removeAdjustment',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const owner = await periodOfAdjustment(tx, id);
      if (!owner) return err(serviceError('not_found', 'periods.adjustmentNotFound'));
      const open = owner.period.status === 'open';
      const frozen = open ? await frozenAdjustments(tx, owner.period, owner.personId) : null;
      if (frozen) return err(serviceError('conflict', frozen));
      const [row] = await tx
        .delete(adjustment)
        .where(eq(adjustment.id, id))
        .returning({ id: adjustment.id });
      if (!row) return err(serviceError('not_found', 'periods.adjustmentNotFound'));
      if (open) await refreshEarlyActs(tx, owner.period);
      return ok(row);
    }),
});
