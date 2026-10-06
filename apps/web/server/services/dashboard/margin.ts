import {
  adjustment,
  agencyTerms,
  assignment,
  billingTerms,
  client,
  contract,
  invoice,
  invoiceLine,
  payrollItem,
  payrollLine,
  payTerms,
  period,
  person,
  plannedExpense,
  timesheet,
} from '@tally/db/schema';
import {
  addMonths,
  forecastMonths,
  startOfMonth,
  toDecimal,
  Decimal,
  type LocalDate,
} from '@tally/domain';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { loadCalendar } from '../periods';
import { loadUsdConverter } from './overview';

type Row = { id: string | null; name: string; revenue: Decimal; pay: Decimal; agency: Decimal };

const view = (rows: Map<string, Row>) =>
  [...rows.values()]
    .map((r) => ({
      id: r.id,
      name: r.name,
      revenueUsd: r.revenue.toFixed(2),
      payUsd: r.pay.toFixed(2),
      agencyUsd: r.agency.toFixed(2),
      marginUsd: r.revenue.minus(r.pay).minus(r.agency).toFixed(2),
    }))
    .sort((a, b) => toDecimal(b.marginUsd).comparedTo(toDecimal(a.marginUsd)));

/**
 * Margin of a closed month by accrual (6.1): invoices of the period minus the payroll accrued for
 * it (agency fees apart), by client and by person, in USD. Adjustments count for the person only.
 */
export const monthMargin = defineService({
  name: 'dashboard.monthMargin',
  input: z.object({
    periodId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  }),
  handler: async (ctx, { periodId }) => {
    const data = await inActorScope(ctx, async (tx) => {
      const closed = await tx
        .select({ id: period.id, month: period.month })
        .from(period)
        .where(eq(period.status, 'closed'))
        .orderBy(desc(period.month))
        .limit(12);
      const current = closed.find((p) => p.id === periodId) ?? closed[0];
      if (!current) return null;
      const toUsd = await loadUsdConverter(tx);
      const billed = await tx
        .select({
          assignmentId: timesheet.assignmentId,
          amount: invoiceLine.amount,
          currency: invoice.currency,
        })
        .from(invoiceLine)
        .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
        .innerJoin(timesheet, eq(timesheet.id, invoiceLine.timesheetId))
        .where(and(eq(invoice.periodId, current.id), ne(invoice.status, 'void')));
      const accrued = await tx
        .select({
          assignmentId: payrollLine.assignmentId,
          amount: payrollLine.amount,
          currency: payrollLine.currency,
          agencyFee: payrollLine.agencyFee,
        })
        .from(payrollLine)
        .innerJoin(payrollItem, eq(payrollItem.id, payrollLine.payrollItemId))
        .where(eq(payrollItem.periodId, current.id));
      const adjustments = await tx
        .select({
          personId: adjustment.personId,
          amount: adjustment.amount,
          currency: adjustment.currency,
        })
        .from(adjustment)
        .where(eq(adjustment.periodId, current.id));
      const ids = [...new Set([...billed, ...accrued].map((r) => r.assignmentId))];
      const owners = ids.length
        ? await tx
            .select({
              id: assignment.id,
              personId: person.id,
              personName: person.fullName,
              clientId: client.id,
              clientName: sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`,
            })
            .from(assignment)
            .innerJoin(person, eq(person.id, assignment.personId))
            .leftJoin(contract, eq(contract.id, assignment.contractId))
            .leftJoin(client, eq(client.id, contract.clientId))
            .where(inArray(assignment.id, ids))
        : [];
      const people = adjustments.length
        ? await tx
            .select({ id: person.id, name: person.fullName })
            .from(person)
            .where(inArray(person.id, [...new Set(adjustments.map((a) => a.personId))]))
        : [];
      return { closed, current, toUsd, billed, accrued, adjustments, owners, people };
    });
    if (!data) return ok(null);
    const unconverted = new Set<string>();
    const usd = (amount: string, currency: string) => {
      const value = data.toUsd(amount, currency);
      if (value === null) unconverted.add(currency);
      return value ?? new Decimal(0);
    };
    const byClient = new Map<string, Row>();
    const byPerson = new Map<string, Row>();
    const zero = (id: string | null, name: string): Row => ({
      id,
      name,
      revenue: new Decimal(0),
      pay: new Decimal(0),
      agency: new Decimal(0),
    });
    const rowsFor = (assignmentId: string) => {
      const o = data.owners.find((x) => x.id === assignmentId);
      if (!o) return [];
      const clientKey = o.clientId ?? 'internal';
      if (!byClient.has(clientKey)) byClient.set(clientKey, zero(o.clientId, o.clientName ?? ''));
      if (!byPerson.has(o.personId)) byPerson.set(o.personId, zero(o.personId, o.personName));
      return [byClient.get(clientKey), byPerson.get(o.personId)].filter((r) => r !== undefined);
    };
    for (const b of data.billed) {
      for (const r of rowsFor(b.assignmentId))
        r.revenue = r.revenue.plus(usd(b.amount, b.currency));
    }
    for (const a of data.accrued) {
      for (const r of rowsFor(a.assignmentId)) {
        if (a.agencyFee) r.agency = r.agency.plus(usd(a.amount, a.currency));
        else r.pay = r.pay.plus(usd(a.amount, a.currency));
      }
    }
    for (const adj of data.adjustments) {
      const name = data.people.find((p) => p.id === adj.personId)?.name ?? '';
      if (!byPerson.has(adj.personId)) byPerson.set(adj.personId, zero(adj.personId, name));
      const r = byPerson.get(adj.personId);
      if (r) r.pay = r.pay.plus(usd(adj.amount, adj.currency));
    }
    const people = view(byPerson);
    const total = people.reduce(
      (s, r) => ({
        revenueUsd: s.revenueUsd.plus(r.revenueUsd),
        payUsd: s.payUsd.plus(r.payUsd),
        agencyUsd: s.agencyUsd.plus(r.agencyUsd),
        marginUsd: s.marginUsd.plus(r.marginUsd),
      }),
      {
        revenueUsd: new Decimal(0),
        payUsd: new Decimal(0),
        agencyUsd: new Decimal(0),
        marginUsd: new Decimal(0),
      },
    );
    return ok({
      period: data.current,
      periods: data.closed,
      byClient: view(byClient),
      byPerson: people,
      total: {
        revenueUsd: total.revenueUsd.toFixed(2),
        payUsd: total.payUsd.toFixed(2),
        agencyUsd: total.agencyUsd.toFixed(2),
        marginUsd: total.marginUsd.toFixed(2),
      },
      unconverted: [...unconverted].sort(),
    });
  },
});

/** Six-month forecast from the current month (6.1, A-069); a period's own norm wins over H. */
export const sixMonthForecast = defineService({
  name: 'dashboard.forecast',
  input: z.object({}),
  handler: async (ctx) => {
    const first = startOfMonth(ctx.today);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(first, i));
    const result = await inActorScope(ctx, async (tx) => {
      const [assignments, billing, pay, agency, planned, periods, cal, toUsd] = await Promise.all([
        tx.select().from(assignment),
        tx.select().from(billingTerms),
        tx.select().from(payTerms),
        tx.select().from(agencyTerms),
        tx.select().from(plannedExpense),
        tx
          .select({ month: period.month, workHours: period.workHours })
          .from(period)
          .where(inArray(period.month, months)),
        loadCalendar(tx),
        loadUsdConverter(tx),
      ]);
      const of = <T extends { assignmentId: string; validFrom: string }>(rows: T[], id: string) =>
        rows
          .filter((r) => r.assignmentId === id)
          .map((r) => ({ ...r, validFrom: r.validFrom as LocalDate }));
      return forecastMonths(
        months.map((month) => ({
          month,
          workHours:
            periods.find((p) => p.month === month)?.workHours ??
            String(cal.workHoursInMonth(month)),
        })),
        assignments.map((a) => ({
          assignmentId: a.id,
          fte: a.fte,
          startsOn: a.startsOn as LocalDate,
          endsOn: a.endsOn as LocalDate | null,
          billing: of(billing, a.id),
          pay: of(pay, a.id),
          agency: of(agency, a.id),
        })),
        planned.map((e) => ({
          ...e,
          startsOn: e.startsOn as LocalDate,
          endsOn: e.endsOn as LocalDate | null,
        })),
        toUsd,
      );
    });
    return ok(result);
  },
});
