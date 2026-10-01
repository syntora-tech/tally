import type { DbTransaction } from '@tally/db';
import {
  assignment,
  billingTerms,
  client,
  contract,
  invoice,
  adjustment,
  invoiceLine,
  payrollItem,
  payTerms,
  period,
  person,
  timesheet,
  workCalendarException,
} from '@tally/db/schema';
import {
  defaultInvoiceDate,
  draftLine,
  dueDate,
  isActiveInMonth,
  payrollPlan,
  periodPreview,
  sum,
  toDecimal,
  WorkCalendar,
  type InvoiceDateRule,
  type LocalDate,
  type PaymentDueRule,
  type PeriodAssignment,
} from '@tally/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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
import { createPayroll, dropPayroll, loadAdjustments, toPlanAdjustments } from './payroll';

export async function loadCalendar(tx: DbTransaction): Promise<WorkCalendar> {
  const rows = await tx
    .select({ date: workCalendarException.onDate, isWorking: workCalendarException.isWorking })
    .from(workCalendarException);
  return new WorkCalendar(rows.map((r) => ({ date: r.date as LocalDate, isWorking: r.isWorking })));
}

const clientLabel = sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`;

type PeriodRow = typeof period.$inferSelect;

/** Everything the wizard needs for one month: assignments with all term versions and hours. */
async function loadPeriodData(tx: DbTransaction, p: PeriodRow) {
  const month = p.month as LocalDate;
  const rows = await tx
    .select({
      assignment,
      personName: person.fullName,
      clientName: clientLabel,
    })
    .from(assignment)
    .innerJoin(person, eq(person.id, assignment.personId))
    .leftJoin(contract, eq(contract.id, assignment.contractId))
    .leftJoin(client, eq(client.id, contract.clientId))
    .orderBy(person.fullName);
  const active = rows.filter((r) =>
    isActiveInMonth(
      {
        startsOn: r.assignment.startsOn as LocalDate,
        endsOn: r.assignment.endsOn as LocalDate | null,
      },
      month,
    ),
  );
  const ids = active.map((r) => r.assignment.id);
  const [billing, pay, hours] = ids.length
    ? await Promise.all([
        tx.select().from(billingTerms).where(inArray(billingTerms.assignmentId, ids)),
        tx.select().from(payTerms).where(inArray(payTerms.assignmentId, ids)),
        tx
          .select()
          .from(timesheet)
          .where(and(eq(timesheet.periodId, p.id), inArray(timesheet.assignmentId, ids))),
      ])
    : [[], [], []];
  const assignments: PeriodAssignment[] = active.map((r) => ({
    assignmentId: r.assignment.id,
    personId: r.assignment.personId,
    personName: r.personName,
    clientName: r.assignment.isInternal ? null : r.clientName,
    contractId: r.assignment.contractId,
    roleTitle: r.assignment.roleTitle,
    isInternal: r.assignment.isInternal,
    startsOn: r.assignment.startsOn as LocalDate,
    endsOn: r.assignment.endsOn as LocalDate | null,
    billing: billing
      .filter((b) => b.assignmentId === r.assignment.id)
      .map((b) => ({
        type: b.type,
        rate: b.rate,
        prorationPolicy: b.prorationPolicy,
        currency: b.currency,
        validFrom: b.validFrom as LocalDate,
      })),
    pay: pay
      .filter((t) => t.assignmentId === r.assignment.id)
      .map((t) => ({
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        validFrom: t.validFrom as LocalDate,
        payoutMethod: t.payoutMethod,
        releasePolicy: t.releasePolicy,
        graceDays: t.graceDays,
      })),
    hours: hours.find((h) => h.assignmentId === r.assignment.id)?.hours ?? null,
    note: hours.find((h) => h.assignmentId === r.assignment.id)?.note ?? null,
  }));
  const timesheetIds = new Map(hours.map((h) => [h.assignmentId, h.id]));
  return { month, assignments, timesheetIds };
}

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
        .innerJoin(person, eq(person.id, payrollItem.personId))
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
  hours: hoursValue,
  /** Project of the month; omitted keeps the stored note, an empty string clears it. */
  note: z.string().trim().max(200).optional(),
});

async function writeHours(
  ctx: ServiceContext,
  periodId: string,
  entries: readonly z.output<typeof hoursEntry>[],
  source: 'manual' | 'import',
) {
  await inActorScope(ctx, async (tx) => {
    for (const e of entries) {
      const note = e.note === undefined ? {} : { note: e.note || null };
      await tx
        .insert(timesheet)
        .values({ periodId, assignmentId: e.assignmentId, hours: e.hours, source, ...note })
        .onConflictDoUpdate({
          target: [timesheet.assignmentId, timesheet.periodId],
          set: { hours: e.hours, source, ...note },
        });
    }
  });
}

/** Step 2: inline hours; closed periods are rejected by I6 (TL030). */
export const setHours = defineService({
  name: 'periods.setHours',
  input: hoursEntry.extend({ periodId: z.uuid() }),
  handler: async (ctx, { periodId, ...entry }) => {
    await writeHours(ctx, periodId, [entry], 'manual');
    return ok({ id: periodId });
  },
});

export const importHours = defineService({
  name: 'periods.importHours',
  input: z.object({ periodId: z.uuid(), rows: z.array(hoursEntry).min(1).max(500) }),
  handler: async (ctx, { periodId, rows }) => {
    await writeHours(ctx, periodId, rows, 'import');
    return ok({ id: periodId, count: rows.length });
  },
});

function describe(personName: string, roleTitle: string | null) {
  const role = roleTitle ? `, ${roleTitle}` : '';
  return {
    descriptionEn: `Software development services — ${personName}${role}`,
    descriptionUa: `Послуги з розробки програмного забезпечення — ${personName}${role}`,
  };
}

/**
 * Step 5: closes the month and (re)creates draft invoices — one per contract × period with a line
 * per assignment that has hours (5.1). Issued invoices of the period are never touched.
 */
export const closePeriod = defineService({
  name: 'periods.close',
  input: z.object({ periodId: z.uuid() }),
  handler: async (ctx, { periodId }) => {
    const result = await inActorScope(ctx, async (tx) => {
      const [p] = await tx.select().from(period).where(eq(period.id, periodId)).for('update');
      if (!p) return err(serviceError('not_found', 'periods.notFound'));
      if (p.status === 'closed') return err(serviceError('conflict', 'periods.alreadyClosed'));
      const { month, assignments, timesheetIds } = await loadPeriodData(tx, p);
      const cal = await loadCalendar(tx);

      await tx
        .delete(invoice)
        .where(and(eq(invoice.periodId, periodId), eq(invoice.status, 'draft')));
      const issued = await tx
        .select({ contractId: invoice.contractId })
        .from(invoice)
        .where(eq(invoice.periodId, periodId));
      const skip = new Set(issued.map((i) => i.contractId));

      const byContract = new Map<
        string,
        { a: PeriodAssignment; line: NonNullable<ReturnType<typeof draftLine>>; currency: string }[]
      >();
      for (const a of assignments) {
        const b = a.billing
          .filter((v) => v.validFrom <= month)
          .sort((x, y) => y.validFrom.localeCompare(x.validFrom))[0];
        if (!b || !a.contractId || skip.has(a.contractId)) continue;
        const line = draftLine(a.assignmentId, b, a.hours ?? '0', p.workHours);
        if (!line) continue;
        byContract.set(a.contractId, [
          ...(byContract.get(a.contractId) ?? []),
          { a, line, currency: b.currency },
        ]);
      }

      let created = 0;
      for (const [contractId, lines] of byContract) {
        const [c] = await tx.select().from(contract).where(eq(contract.id, contractId));
        if (!c?.clientId) continue;
        const foreign = lines.find((l) => l.currency !== c.currency);
        if (foreign) {
          return err(
            serviceError(
              'conflict',
              msg('periods.rateCurrency', {
                person: foreign.a.personName,
                rateCurrency: foreign.currency,
                contract: c.number,
                contractCurrency: c.currency,
              }),
            ),
          );
        }
        const issueDate = defaultInvoiceDate(c.invoiceDateRule as InvoiceDateRule, month, cal);
        const [inv] = await tx
          .insert(invoice)
          .values({
            clientId: c.clientId,
            contractId,
            periodId,
            issueDate,
            dueDate: dueDate(c.paymentDueRule as PaymentDueRule, issueDate),
            currency: c.currency,
            total: sum(lines.map((l) => l.line.amount)).toFixed(2),
          })
          .returning({ id: invoice.id });
        if (!inv) throw new Error('Invoice insert returned no row');
        await tx.insert(invoiceLine).values(
          lines.map((l, i) => ({
            invoiceId: inv.id,
            timesheetId: timesheetIds.get(l.a.assignmentId) ?? null,
            position: i + 1,
            ...describe(l.a.personName, l.a.roleTitle),
            quantity: l.line.quantity,
            unitPrice: l.line.unitPrice,
            amount: l.line.amount,
          })),
        );
        created++;
      }

      const adjustments = toPlanAdjustments(await loadAdjustments(tx, periodId));
      const payrollItems = await createPayroll(tx, {
        periodId,
        plan: payrollPlan(month, p.workHours, p.referenceFxUsdUah, assignments, adjustments),
        assignments,
        timesheetIds,
        today: ctx.today,
        cal,
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
  handler: async (ctx, { periodId, reason }) => {
    const [row] = await inActorScope(ctx, async (tx) => {
      await tx.execute(sql`select set_config('app.reason', ${reason}, true)`);
      const rows = await tx
        .update(period)
        .set({ status: 'open', closedAt: null, closedBy: null })
        .where(and(eq(period.id, periodId), eq(period.status, 'closed')))
        .returning({ id: period.id });
      if (rows.length) await dropPayroll(tx, periodId);
      return rows;
    });
    return row ? ok(row) : err(serviceError('conflict', 'periods.notClosed'));
  },
});

/** Step 4 (6.4): bonus, deduction or compensation with a reason; closed periods refuse it (I6). */
export const addAdjustment = defineService({
  name: 'periods.addAdjustment',
  input: z.object({
    periodId: z.uuid(),
    personId: z.uuid({ error: 'field.person' }),
    payoutMethod: z.enum(['fiat', 'crypto']).default('fiat'),
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
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .insert(adjustment)
        .values({ ...input, amount })
        .returning({ id: adjustment.id }),
    );
    return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
  },
});

export const removeAdjustment = defineService({
  name: 'periods.removeAdjustment',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx.delete(adjustment).where(eq(adjustment.id, id)).returning({ id: adjustment.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'periods.adjustmentNotFound'));
  },
});
