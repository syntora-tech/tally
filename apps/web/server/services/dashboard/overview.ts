import type { DbTransaction } from '@tally/db';
import { client, contract, fxRate, invoice, plannedExpense } from '@tally/db/schema';
import {
  addDays,
  addMonths,
  defaultActDate,
  defaultInvoiceDate,
  diffDays,
  plannedExpenseDates,
  startOfMonth,
  toDecimal,
  usdConverter,
  Decimal,
  type ActDateRule,
  type DecimalInput,
  type InvoiceDateRule,
  type LocalDate,
} from '@tally/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { listAccounts } from '../ledger';
import { listPayroll } from '../payroll';
import { loadCalendar } from '../periods';

const CALENDAR_DAYS = 30;

export async function loadUsdConverter(tx: DbTransaction) {
  const rates = await tx
    .select({ onDate: fxRate.onDate, base: fxRate.base, quote: fxRate.quote, rate: fxRate.rate })
    .from(fxRate);
  return usdConverter(rates.map((r) => ({ ...r, onDate: r.onDate as LocalDate })));
}

const clientLabel = sql<string>`coalesce(${client.shortName}, ${client.legalName})`;

export type CalendarEvent = {
  on: LocalDate;
  kind: 'invoice_due' | 'payout_deadline' | 'payable_now' | 'planned' | 'invoice_date' | 'act_date';
  label: string;
  /** Money out (−) or expected in (+), USD; null for date-only events. */
  usd: string | null;
  href: string;
};

/**
 * Dashboard figures (6.1): treasury in USD, receivables with days to or past due, obligations to
 * people in three sums, and a 30-day calendar with a cash warning that assumes no client pays.
 */
export const dashboardOverview = defineService({
  name: 'dashboard.overview',
  input: z.object({}),
  handler: async (ctx) => {
    const [accounts, payroll] = await Promise.all([
      listAccounts.run(ctx, {}),
      listPayroll.run(ctx, { periodId: '' }),
    ]);
    const today = ctx.today;
    const until = addDays(today, CALENDAR_DAYS);
    const data = await inActorScope(ctx, async (tx) => {
      const toUsd = await loadUsdConverter(tx);
      const cal = await loadCalendar(tx);
      const invoices = await tx
        .select({
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          clientName: clientLabel,
          currency: invoice.currency,
          total: invoice.total,
          paidAmount: invoice.paidAmount,
          dueDate: invoice.dueDate,
          writtenOffOn: invoice.writtenOffOn,
        })
        .from(invoice)
        .innerJoin(client, eq(client.id, invoice.clientId))
        .where(inArray(invoice.status, ['issued', 'partially_paid', 'written_off']))
        .orderBy(invoice.dueDate);
      const planned = await tx.select().from(plannedExpense);
      const contracts = await tx
        .select({
          id: contract.id,
          kind: contract.kind,
          number: contract.number,
          invoiceDateRule: contract.invoiceDateRule,
          actDateRule: contract.actDateRule,
        })
        .from(contract)
        .where(eq(contract.status, 'active'));
      return { toUsd, cal, invoices, planned, contracts };
    });
    const { toUsd, cal } = data;
    const unconverted = new Set<string>();
    const usd = (amount: DecimalInput, currency: string) => {
      const value = toUsd(amount, currency);
      if (value === null) unconverted.add(currency);
      return value;
    };

    const balances = accounts.unwrapOr([]).map(({ account: a, balance }) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      balance,
      usd: usd(balance, a.currency)?.toFixed(2) ?? null,
    }));
    const treasuryUsd = balances.reduce((s, b) => s.plus(b.usd ?? '0'), new Decimal(0));

    const open = data.invoices.filter((i) => i.status !== 'written_off');
    const receivables = open.map((i) => {
      const remaining = toDecimal(i.total).minus(i.paidAmount);
      return {
        ...i,
        remaining: remaining.toFixed(2),
        remainingUsd: usd(remaining, i.currency)?.toFixed(2) ?? null,
        /** Positive: days past due; negative: days left. */
        daysPastDue: diffDays(i.dueDate as LocalDate, today),
      };
    });
    const badDebtUsd = data.invoices
      .filter((i) => i.status === 'written_off')
      .reduce(
        (s, i) => s.plus(usd(toDecimal(i.total).minus(i.paidAmount), i.currency) ?? '0'),
        new Decimal(0),
      );

    const items = payroll.unwrapOr([]).filter((i) => i.group !== 'paid');
    let awaitingUsd = new Decimal(0);
    let payableUsd = new Decimal(0);
    const events: CalendarEvent[] = [];
    for (const i of items) {
      const title = i.item.kind === 'agency' ? (i.payeeName ?? '') : (i.personName ?? '');
      for (const l of i.lines) {
        if (l.status !== 'accrued' && l.status !== 'awaiting_client') continue;
        awaitingUsd = awaitingUsd.plus(l.amountUsd);
        if (l.deadline && l.deadline <= until) {
          events.push({
            on: l.deadline < today ? today : l.deadline,
            kind: 'payout_deadline',
            label: title,
            usd: toDecimal(l.amountUsd).neg().toFixed(2),
            href: `/payroll?period=${i.item.periodId}`,
          });
        }
      }
      const paidUsd =
        i.item.payoutMethod === 'fiat'
          ? i.item.payoutFxRate
            ? toDecimal(i.item.paidAmount).div(i.item.payoutFxRate)
            : new Decimal(0)
          : toDecimal(i.item.paidAmount);
      const free = Decimal.max(toDecimal(i.payableUsd).minus(paidUsd), '0');
      if (free.gt(0)) {
        payableUsd = payableUsd.plus(free);
        events.push({
          on: today,
          kind: 'payable_now',
          label: title,
          usd: free.neg().toFixed(2),
          href: `/payroll?period=${i.item.periodId}`,
        });
      }
    }

    for (const r of receivables) {
      if (r.dueDate <= until) {
        events.push({
          on: r.dueDate < today ? today : (r.dueDate as LocalDate),
          kind: 'invoice_due',
          label: `${r.clientName} · ${r.number ?? ''}`,
          usd: r.remainingUsd,
          href: `/invoices/${r.id}`,
        });
      }
    }
    for (const e of data.planned) {
      const terms = {
        ...e,
        startsOn: e.startsOn as LocalDate,
        endsOn: e.endsOn as LocalDate | null,
      };
      for (const on of plannedExpenseDates(terms, today, 2)) {
        if (on < today || on > until) continue;
        events.push({
          on,
          kind: 'planned',
          label: e.name,
          usd: usd(e.amount, e.currency)?.neg().toFixed(2) ?? null,
          href: '/ledger/planned',
        });
      }
    }
    const thisMonth = startOfMonth(today);
    for (const month of [addMonths(thisMonth, -1), thisMonth]) {
      const invoiceDates = new Set<LocalDate>();
      const actDates = new Set<LocalDate>();
      for (const c of data.contracts) {
        if (c.kind === 'client' && c.invoiceDateRule) {
          invoiceDates.add(defaultInvoiceDate(c.invoiceDateRule as InvoiceDateRule, month, cal));
        }
        if (c.kind === 'fop' && c.actDateRule) {
          const on = defaultActDate(c.actDateRule as ActDateRule, month, cal);
          if (on) actDates.add(on);
        }
      }
      for (const [kind, dates, href] of [
        ['invoice_date', invoiceDates, '/periods'],
        ['act_date', actDates, '/payroll/acts'],
      ] as const) {
        for (const on of dates) {
          if (on >= today && on <= until) events.push({ on, kind, label: month, usd: null, href });
        }
      }
    }
    events.sort((a, b) => a.on.localeCompare(b.on) || a.kind.localeCompare(b.kind));

    // Cash check (6.1): outflows only, as if no client paid in the next 30 days.
    let running = treasuryUsd;
    let shortfallOn: LocalDate | null = null;
    for (const e of events) {
      if (e.usd === null || !e.usd.startsWith('-')) continue;
      running = running.plus(e.usd);
      if (running.isNegative() && !shortfallOn) shortfallOn = e.on;
    }

    return ok({
      balances,
      treasuryUsd: treasuryUsd.toFixed(2),
      receivables,
      receivablesUsd: receivables
        .reduce((s, r) => s.plus(r.remainingUsd ?? '0'), new Decimal(0))
        .toFixed(2),
      badDebtUsd: badDebtUsd.toFixed(2),
      awaitingUsd: awaitingUsd.toFixed(2),
      payableUsd: payableUsd.toFixed(2),
      events,
      cashAfterOutflowsUsd: running.toFixed(2),
      shortfallOn,
      unconverted: [...unconverted].sort(),
    });
  },
});
