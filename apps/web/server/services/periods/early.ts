import type { DbTransaction } from '@tally/db';
import {
  adjustment,
  assignment,
  contract,
  contractAnnex,
  invoice,
  invoiceLine,
  payee,
  period,
  person,
  supplierAct,
  timesheet,
} from '@tally/db/schema';
import {
  defaultActDate,
  endOfMonth,
  payrollPlan,
  payrollTotalUah,
  personHours,
  toDecimal,
  type ActDateRule,
  type LocalDate,
} from '@tally/domain';
import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError, type ServiceError } from '../errors';
import { decimalString } from '../fields';
import { ensureNbuRate } from '../fx';
import {
  invoiceGroups,
  invoiceKey,
  loadCalendar,
  loadPeriodData,
  writeDraftInvoice,
  type PeriodRow,
} from './data';
import { loadAdjustments, toPlanAdjustments } from './payroll';

/*
 * Documents before the period closes (A-076): a client invoice per contract (or SOW with its own
 * rules) and a monthly FOP act per person at an approved rate. Drafts follow the hours; an issued
 * document freezes the hours it covers.
 */

async function openPeriodRow(tx: DbTransaction, periodId: string) {
  const [p] = await tx.select().from(period).where(eq(period.id, periodId)).for('update');
  if (!p) return err(serviceError('not_found', 'periods.notFound'));
  if (p.status === 'closed') return err(serviceError('conflict', 'periods.closedOrMissing'));
  return ok(p);
}

/** Rebuilds one invoice group's draft from the current hours; `create` also starts a missing one. */
async function rebuildDraftInvoice(
  tx: DbTransaction,
  p: PeriodRow,
  target: { contractId: string; annexId: string | null },
  create: boolean,
): Promise<Result<{ id: string } | null, ServiceError>> {
  const sameGroup = and(
    eq(invoice.periodId, p.id),
    eq(invoice.contractId, target.contractId),
    target.annexId ? eq(invoice.annexId, target.annexId) : isNull(invoice.annexId),
  );
  const existing = await tx
    .select({ id: invoice.id, status: invoice.status, number: invoice.number })
    .from(invoice)
    .where(and(sameGroup, ne(invoice.status, 'void')));
  const issued = existing.find((i) => i.status !== 'draft');
  if (issued) {
    return create
      ? err(
          serviceError('conflict', msg('periods.alreadyInvoiced', { number: issued.number ?? '' })),
        )
      : ok(null);
  }
  if (!create && existing.length === 0) return ok(null);
  await tx.delete(invoice).where(and(sameGroup, eq(invoice.status, 'draft')));
  const data = await loadPeriodData(tx, p);
  const { groups, annexes } = await invoiceGroups(
    tx,
    data.month,
    p.workHours,
    data.assignments,
    data.annexIds,
  );
  const group = groups.get(invoiceKey(target.contractId, target.annexId));
  if (!group)
    return create ? err(serviceError('validation_error', 'periods.nothingToInvoice')) : ok(null);
  return writeDraftInvoice(tx, {
    periodId: p.id,
    month: data.month,
    cal: await loadCalendar(tx),
    group,
    annexes,
    timesheetIds: data.timesheetIds,
  });
}

/** Early draft invoices follow the hours until they are issued. */
export async function refreshEarlyInvoices(tx: DbTransaction, p: PeriodRow) {
  const drafts = await tx
    .selectDistinct({ contractId: invoice.contractId, annexId: invoice.annexId })
    .from(invoice)
    .where(and(eq(invoice.periodId, p.id), eq(invoice.status, 'draft')));
  for (const d of drafts) {
    const rebuilt = await rebuildDraftInvoice(tx, p, d, false);
    if (rebuilt.isErr()) return rebuilt;
  }
  return ok(null);
}

export const draftEarlyInvoice = defineService({
  name: 'periods.draftInvoice',
  input: z.object({
    periodId: z.uuid(),
    contractId: z.uuid(),
    annexId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().default(null)),
  }),
  handler: (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const p = await openPeriodRow(tx, input.periodId);
      if (p.isErr()) return err(p.error);
      return rebuildDraftInvoice(tx, p.value, input, true);
    }),
});

type PersonPay = {
  personId: string;
  personName: string;
  payeeId: string;
  payeeName: string;
  usd: string;
  uah: string;
};

/** People paid in fiat to their FOP this month, with the USD and UAH parts of that pay. */
async function fiatPay(tx: DbTransaction, p: PeriodRow): Promise<PersonPay[]> {
  const data = await loadPeriodData(tx, p);
  const plan = payrollPlan(
    data.month,
    p.workHours,
    null,
    data.assignments,
    toPlanAdjustments(await loadAdjustments(tx, p.id)),
  ).filter((i) => i.payoutMethod === 'fiat');
  if (!plan.length) return [];
  const fops = await tx
    .select({
      personId: person.id,
      payeeId: payee.id,
      payeeName: sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn}, '')`,
    })
    .from(person)
    .innerJoin(payee, and(eq(payee.id, person.defaultPayeeId), eq(payee.kind, 'fop')))
    .where(
      inArray(
        person.id,
        plan.map((i) => i.personId),
      ),
    );
  return plan.flatMap((i) => {
    const fop = fops.find((f) => f.personId === i.personId);
    return fop
      ? [
          {
            personId: i.personId,
            personName: i.personName,
            payeeId: fop.payeeId,
            payeeName: fop.payeeName,
            usd: i.totalUsd,
            uah: i.totalUahPart,
          },
        ]
      : [];
  });
}

const monthlyActOf = (payeeId: string, month: LocalDate) =>
  and(
    eq(supplierAct.payeeId, payeeId),
    eq(supplierAct.type, 'monthly'),
    eq(supplierAct.periodFrom, month),
    ne(supplierAct.status, 'void'),
  );

const actTotal = (pay: PersonPay, rate: string | null) =>
  payrollTotalUah(
    [
      { amount: pay.usd, currency: 'USD' },
      { amount: pay.uah, currency: 'UAH' },
    ],
    [],
    rate,
  );

/** Early draft acts follow the pay at their approved rate until they are issued. */
export async function refreshEarlyActs(tx: DbTransaction, p: PeriodRow) {
  const month = p.month as LocalDate;
  const drafts = await tx
    .select()
    .from(supplierAct)
    .where(
      and(
        eq(supplierAct.type, 'monthly'),
        eq(supplierAct.periodFrom, month),
        eq(supplierAct.status, 'draft'),
        isNull(supplierAct.payrollItemId),
      ),
    );
  if (!drafts.length) return;
  const pay = await fiatPay(tx, p);
  for (const act of drafts) {
    const own = pay.find((x) => x.payeeId === act.payeeId);
    const total = own ? actTotal(own, act.fxRate) : null;
    if (total?.isOk()) {
      await tx
        .update(supplierAct)
        .set({ amountUah: total.value.toFixed(2) })
        .where(eq(supplierAct.id, act.id));
    }
  }
}

export const draftEarlyAct = defineService({
  name: 'periods.draftAct',
  input: z.object({
    periodId: z.uuid(),
    personId: z.uuid(),
    rate: z.preprocess(
      (v) => (v === '' ? undefined : v),
      decimalString.refine((v) => toDecimal(v).gt(0), 'fx.ratePositive2').optional(),
    ),
    rateSource: z.enum(['bank_actual', 'nbu', 'manual']).default('manual'),
  }),
  handler: (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const p = await openPeriodRow(tx, input.periodId);
      if (p.isErr()) return err(p.error);
      const month = p.value.month as LocalDate;
      const pay = (await fiatPay(tx, p.value)).find((x) => x.personId === input.personId);
      if (!pay) return err(serviceError('validation_error', 'periods.noFopPay'));
      const usdPart = !toDecimal(pay.usd).isZero();
      if (usdPart && !input.rate) {
        return err(
          serviceError('validation_error', 'payroll.rateFirst', { rate: ['payroll.rateFirst'] }),
        );
      }
      const rate = usdPart && input.rate ? toDecimal(input.rate).toFixed(6) : null;
      const total = actTotal(pay, rate);
      if (total.isErr()) return err(serviceError('validation_error', 'payroll.rateFirst'));
      const values = {
        amountUah: total.value.toFixed(2),
        fxRate: rate,
        fxSource: rate ? input.rateSource : null,
      };

      const [existing] = await tx
        .select()
        .from(supplierAct)
        .where(monthlyActOf(pay.payeeId, month));
      if (existing) {
        if (existing.status !== 'draft') {
          return err(
            serviceError(
              'conflict',
              msg('periods.actAlreadyIssued', { number: existing.number ?? '' }),
            ),
          );
        }
        await tx.update(supplierAct).set(values).where(eq(supplierAct.id, existing.id));
        return ok({ id: existing.id });
      }
      const [fop] = await tx
        .select()
        .from(contract)
        .where(and(eq(contract.payeeId, pay.payeeId), eq(contract.kind, 'fop')))
        .orderBy(desc(contract.signedOn))
        .limit(1);
      if (!fop) return err(serviceError('validation_error', 'periods.noFopContract'));
      const actDate =
        defaultActDate(fop.actDateRule as ActDateRule, month, await loadCalendar(tx)) ??
        endOfMonth(month);
      const [act] = await tx
        .insert(supplierAct)
        .values({
          contractId: fop.id,
          payeeId: pay.payeeId,
          type: 'monthly',
          actDate,
          periodFrom: month,
          periodTo: endOfMonth(month),
          ...values,
        })
        .returning({ id: supplierAct.id });
      return act ? ok(act) : err(serviceError('forbidden', 'general.forbidden'));
    }),
});

/**
 * Hours an issued document already covers cannot change (A-076): client hours on an issued
 * invoice line, a person's paid hours once their monthly act is issued.
 */
export async function frozenHours(
  tx: DbTransaction,
  p: PeriodRow,
  entries: readonly { assignmentId: string; hours: string; payHours?: string | null }[],
): Promise<string | null> {
  if (!entries.length) return null;
  const ids = entries.map((e) => e.assignmentId);
  const stored = await tx
    .select({
      assignmentId: timesheet.assignmentId,
      hours: timesheet.hours,
      payHours: timesheet.payHours,
      personId: person.id,
      personName: person.fullName,
      payeeId: person.defaultPayeeId,
    })
    .from(timesheet)
    .innerJoin(assignment, eq(assignment.id, timesheet.assignmentId))
    .innerJoin(person, eq(person.id, assignment.personId))
    .where(and(eq(timesheet.periodId, p.id), inArray(timesheet.assignmentId, ids)));
  const invoiced = await tx
    .select({ timesheetId: invoiceLine.timesheetId, number: invoice.number })
    .from(invoiceLine)
    .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
    .where(and(eq(invoice.periodId, p.id), notInArray(invoice.status, ['draft', 'void'])));
  const timesheets = await tx
    .select({ id: timesheet.id, assignmentId: timesheet.assignmentId })
    .from(timesheet)
    .where(and(eq(timesheet.periodId, p.id), inArray(timesheet.assignmentId, ids)));
  const acted = await tx
    .select({ payeeId: supplierAct.payeeId, number: supplierAct.number })
    .from(supplierAct)
    .where(
      and(
        eq(supplierAct.type, 'monthly'),
        eq(supplierAct.periodFrom, p.month),
        eq(supplierAct.status, 'issued'),
      ),
    );
  for (const e of entries) {
    const before = stored.find((s) => s.assignmentId === e.assignmentId);
    const ts = timesheets.find((t) => t.assignmentId === e.assignmentId);
    const inv = ts && invoiced.find((i) => i.timesheetId === ts.id);
    const oldHours = toDecimal(before?.hours ?? '0');
    if (inv && !oldHours.eq(toDecimal(e.hours))) {
      return msg('periods.hoursInvoiced', { number: inv.number ?? '' });
    }
    const act = before?.payeeId ? acted.find((a) => a.payeeId === before.payeeId) : undefined;
    if (act) {
      const oldPaid = personHours({ hours: before?.hours ?? null, payHours: before?.payHours });
      const newPaid = personHours({
        hours: e.hours,
        payHours: e.payHours === undefined ? (before?.payHours ?? null) : e.payHours,
      });
      if (!toDecimal(oldPaid).eq(toDecimal(newPaid))) {
        return msg('periods.hoursActed', {
          number: act.number ?? '',
          person: before?.personName ?? '',
        });
      }
    }
  }
  return null;
}

/** Adjustments of a person whose monthly act is issued would change an issued amount. */
export async function frozenAdjustments(tx: DbTransaction, p: PeriodRow, personId: string) {
  const [act] = await tx
    .select({ number: supplierAct.number })
    .from(supplierAct)
    .innerJoin(person, eq(person.defaultPayeeId, supplierAct.payeeId))
    .where(
      and(
        eq(person.id, personId),
        eq(supplierAct.type, 'monthly'),
        eq(supplierAct.periodFrom, p.month),
        eq(supplierAct.status, 'issued'),
      ),
    );
  return act ? msg('periods.adjustmentActed', { number: act.number ?? '' }) : null;
}

export async function periodOf(tx: DbTransaction, periodId: string) {
  const [p] = await tx.select().from(period).where(eq(period.id, periodId));
  return p ?? null;
}

export async function periodOfAdjustment(tx: DbTransaction, adjustmentId: string) {
  const [row] = await tx
    .select({ period, personId: adjustment.personId })
    .from(adjustment)
    .innerJoin(period, eq(period.id, adjustment.periodId))
    .where(eq(adjustment.id, adjustmentId));
  return row ?? null;
}

/** Step 3 documents: invoice groups and FOP acts with their state, for the wizard (A-076). */
export const periodDocuments = defineService({
  name: 'periods.documents',
  input: z.object({ periodId: z.uuid() }),
  handler: async (ctx, { periodId }) => {
    const nbu = await ensureNbuRate(ctx.db, 'USD', ctx.today);
    const data = await inActorScope(ctx, async (tx) => {
      const p = await periodOf(tx, periodId);
      if (!p) return null;
      const loaded = await loadPeriodData(tx, p);
      const { groups } = await invoiceGroups(
        tx,
        loaded.month,
        p.workHours,
        loaded.assignments,
        loaded.annexIds,
      );
      const invoices = await tx
        .select({
          id: invoice.id,
          contractId: invoice.contractId,
          annexId: invoice.annexId,
          status: invoice.status,
          number: invoice.number,
          total: invoice.total,
          currency: invoice.currency,
        })
        .from(invoice)
        .where(and(eq(invoice.periodId, periodId), ne(invoice.status, 'void')));
      const contractIds = [...new Set([...groups.values()].map((g) => g.contractId))];
      const contracts = contractIds.length
        ? await tx
            .select({ id: contract.id, number: contract.number, currency: contract.currency })
            .from(contract)
            .where(inArray(contract.id, contractIds))
        : [];
      const annexIds = [...groups.values()].flatMap((g) => (g.annexId ? [g.annexId] : []));
      const annexes = annexIds.length
        ? await tx
            .select({
              id: contractAnnex.id,
              kind: contractAnnex.kind,
              number: contractAnnex.number,
            })
            .from(contractAnnex)
            .where(inArray(contractAnnex.id, annexIds))
        : [];
      const pay = await fiatPay(tx, p);
      const acts = pay.length
        ? await tx
            .select()
            .from(supplierAct)
            .where(
              and(
                inArray(
                  supplierAct.payeeId,
                  pay.map((x) => x.payeeId),
                ),
                eq(supplierAct.type, 'monthly'),
                eq(supplierAct.periodFrom, p.month),
                ne(supplierAct.status, 'void'),
              ),
            )
        : [];
      return {
        open: p.status === 'open',
        invoices: [...groups.values()].map((g) => {
          const c = contracts.find((x) => x.id === g.contractId);
          const a = g.annexId ? annexes.find((x) => x.id === g.annexId) : undefined;
          const inv = invoices.find(
            (i) => i.contractId === g.contractId && i.annexId === g.annexId,
          );
          return {
            contractId: g.contractId,
            annexId: g.annexId,
            label: [
              g.lines[0]?.a.clientName,
              c?.number,
              a ? `${a.kind.toUpperCase()} ${a.number}` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            people: g.lines.map((l) => l.a.personName),
            invoice: inv ?? null,
          };
        }),
        acts: pay.map((x) => {
          const act = acts.find((a) => a.payeeId === x.payeeId);
          return {
            ...x,
            needsRate: !toDecimal(x.usd).isZero(),
            act: act
              ? {
                  id: act.id,
                  status: act.status,
                  number: act.number,
                  amountUah: act.amountUah,
                  fxRate: act.fxRate,
                }
              : null,
          };
        }),
      };
    });
    if (!data) return err(serviceError('not_found', 'periods.notFound'));
    return ok({ ...data, nbuRate: nbu.isOk() ? nbu.value.rate : null });
  },
});
