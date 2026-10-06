import type { DbTransaction } from '@tally/db';
import { company, contract, payee, payrollItem, period, supplierAct } from '@tally/db/schema';
import {
  addMonths,
  defaultActDate,
  endOfMonth,
  startOfMonth,
  sum,
  type ActDateRule,
  type LocalDate,
} from '@tally/domain';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { enqueueJob, type NewJob } from '../../jobs/queue';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import {
  decimalString,
  httpUrl,
  localDateString,
  optionalLocalDate,
  optionalText,
  requiredText,
} from '../fields';
import { loadCalendar } from '../periods';
import { buildActSnapshot } from './snapshot';

const payeeName = sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;

export const renderActJob = (actId: string): NewJob => ({
  kind: 'render_act',
  payload: { actId },
  dedupeKey: `render_act:${actId}`,
});

/**
 * Draft monthly act for a fiat FOP payout (6.6): date by the contract's act rule (default — last
 * working day of the period), amount = the item's total_uah. One act per payroll item.
 */
export async function ensureMonthlyActDraft(tx: DbTransaction, itemId: string) {
  const [row] = await tx
    .select({ item: payrollItem, month: period.month, payeeKind: payee.kind })
    .from(payrollItem)
    .innerJoin(period, eq(period.id, payrollItem.periodId))
    .leftJoin(payee, eq(payee.id, payrollItem.payeeId))
    .where(eq(payrollItem.id, itemId));
  if (!row?.item.payeeId || row.payeeKind !== 'fop' || row.item.payoutMethod !== 'fiat')
    return null;
  if (!row.item.totalUah) return null;
  const [existing] = await tx
    .select({ id: supplierAct.id })
    .from(supplierAct)
    .where(and(eq(supplierAct.payrollItemId, itemId), sql`${supplierAct.status} <> 'void'`));
  if (existing) return existing;
  const [fop] = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.payeeId, row.item.payeeId), eq(contract.kind, 'fop')))
    .orderBy(desc(contract.signedOn))
    .limit(1);
  if (!fop) return null;
  const month = row.month as LocalDate;
  const cal = await loadCalendar(tx);
  const actDate = defaultActDate(fop.actDateRule as ActDateRule, month, cal) ?? endOfMonth(month);
  const [act] = await tx
    .insert(supplierAct)
    .values({
      contractId: fop.id,
      payeeId: row.item.payeeId,
      payrollItemId: itemId,
      type: 'monthly',
      actDate,
      periodFrom: month,
      periodTo: endOfMonth(month),
      amountUah: row.item.totalUah,
    })
    .returning({ id: supplierAct.id });
  return act ?? null;
}

/** A monthly act still in draft follows its payroll item's total_uah (A-076). */
export async function syncMonthlyActDraft(tx: DbTransaction, itemId: string) {
  const [item] = await tx
    .select({ totalUah: payrollItem.totalUah })
    .from(payrollItem)
    .where(eq(payrollItem.id, itemId));
  if (!item?.totalUah) return;
  await tx
    .update(supplierAct)
    .set({ amountUah: item.totalUah })
    .where(
      and(
        eq(supplierAct.payrollItemId, itemId),
        eq(supplierAct.type, 'monthly'),
        eq(supplierAct.status, 'draft'),
      ),
    );
}

/** The issued (not void) monthly act of a payroll item, if any: it freezes the item's money. */
export async function issuedMonthlyAct(tx: DbTransaction, itemIds: string[]) {
  if (!itemIds.length) return null;
  const [act] = await tx
    .select({ id: supplierAct.id, number: supplierAct.number })
    .from(supplierAct)
    .where(
      and(
        inArray(supplierAct.payrollItemId, itemIds),
        eq(supplierAct.type, 'monthly'),
        eq(supplierAct.status, 'issued'),
      ),
    )
    .limit(1);
  return act ?? null;
}

export const actFilters = z.object({
  payeeId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  year: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().min(2000).max(2100).optional(),
  ),
});

/**
 * Acts registry (6.6): replaces the `Реестр актов` sheet — filter by counterparty and year, totals
 * per counterparty, and months without a monthly act between a payee's first and last act (A9).
 */
export const listActs = defineService({
  name: 'acts.list',
  input: actFilters,
  handler: async (ctx, { payeeId, year }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          act: supplierAct,
          payeeName,
          contractNumber: contract.number,
        })
        .from(supplierAct)
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .where(
          and(
            payeeId ? eq(supplierAct.payeeId, payeeId) : undefined,
            year ? gte(supplierAct.actDate, `${String(year)}-01-01`) : undefined,
            year ? lt(supplierAct.actDate, `${String(year + 1)}-01-01`) : undefined,
          ),
        )
        .orderBy(asc(payeeName), desc(supplierAct.actDate)),
    );
    const byPayee = new Map<
      string,
      { payeeId: string; payeeName: string; total: string; missing: string[] }
    >();
    for (const r of rows) {
      const key = r.act.payeeId;
      if (byPayee.has(key)) continue;
      const own = rows.filter((x) => x.act.payeeId === key && x.act.status !== 'void');
      const months = new Set(
        own
          .filter((x) => x.act.type === 'monthly')
          .map((x) => (x.act.periodFrom ?? startOfMonth(x.act.actDate as LocalDate)).slice(0, 7)),
      );
      const sorted = [...months].sort();
      const missing: string[] = [];
      if (sorted.length > 1) {
        let m = `${sorted[0] ?? ''}-01` as LocalDate;
        const last = `${sorted.at(-1) ?? ''}-01`;
        while (m < last) {
          if (!months.has(m.slice(0, 7))) missing.push(m.slice(0, 7));
          m = addMonths(m, 1);
        }
      }
      byPayee.set(key, {
        payeeId: key,
        payeeName: r.payeeName,
        total: sum(
          own.filter((x) => x.act.status === 'issued').map((x) => x.act.amountUah),
        ).toFixed(2),
        missing,
      });
    }
    return ok({ acts: rows, summary: [...byPayee.values()] });
  },
});

export const getAct = defineService({
  name: 'acts.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({ act: supplierAct, payeeName, contract })
        .from(supplierAct)
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .where(eq(supplierAct.id, id)),
    );
    return row ? ok(row) : err(serviceError('not_found', 'acts.notFound'));
  },
});

/** Out-of-cycle act (reimbursement of a trip or other) with a manual date (6.6). */
export const createAct = defineService({
  name: 'acts.create',
  input: z.object({
    contractId: z.uuid({ error: 'acts.chooseContract' }),
    type: z.enum(['reimbursement', 'other']),
    actDate: localDateString,
    periodFrom: optionalLocalDate,
    periodTo: optionalLocalDate,
    amountUah: decimalString,
    dateOverrideReason: optionalText,
  }),
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const [c] = await tx.select().from(contract).where(eq(contract.id, input.contractId));
      if (!c?.payeeId || c.kind !== 'fop') {
        return err(serviceError('validation_error', 'acts.chooseFopContract'));
      }
      const [row] = await tx
        .insert(supplierAct)
        .values({ ...input, payeeId: c.payeeId })
        .returning({ id: supplierAct.id });
      return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
    }),
});

/** Draft edits: date (and amount of a non-monthly act); monthly amounts follow total_uah. */
export const saveActDraft = defineService({
  name: 'acts.saveDraft',
  input: z.object({
    id: z.uuid(),
    actDate: localDateString,
    amountUah: z.preprocess((v) => (v === '' ? undefined : v), decimalString.optional()),
    dateOverrideReason: optionalText,
  }),
  handler: async (ctx, { id, ...values }) =>
    inActorScope(ctx, async (tx) => {
      const [act] = await tx.select().from(supplierAct).where(eq(supplierAct.id, id));
      if (!act) return err(serviceError('not_found', 'acts.notFound'));
      if (act.status !== 'draft') return err(serviceError('conflict', 'acts.issuedLocked'));
      await tx
        .update(supplierAct)
        .set({
          actDate: values.actDate,
          dateOverrideReason: values.dateOverrideReason,
          ...(act.type !== 'monthly' && values.amountUah ? { amountUah: values.amountUah } : {}),
        })
        .where(eq(supplierAct.id, id));
      return ok({ id });
    }),
});

/** Issue (6.6 "як у інвойса"): number from the contract sequence, snapshot, render job. */
export const issueAct = defineService({
  name: 'acts.issue',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select({ act: supplierAct, contract, payee })
        .from(supplierAct)
        .innerJoin(contract, eq(contract.id, supplierAct.contractId))
        .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
        .where(eq(supplierAct.id, id))
        .for('update', { of: supplierAct });
      if (!row) return err(serviceError('not_found', 'acts.notFound'));
      if (row.act.status !== 'draft') return err(serviceError('conflict', 'acts.alreadyIssued'));
      if (!row.contract.numberSequenceKey) {
        return err(serviceError('validation_error', 'acts.noSequence'));
      }
      const [co] = await tx.select().from(company).orderBy(asc(company.createdAt)).limit(1);
      if (!co) return err(serviceError('conflict', 'company.missingShort'));
      const [numbered] = await tx.execute<{ n: string }>(
        sql`select public.issue_number(${row.contract.numberSequenceKey}, ${row.act.actDate}::date, ${row.contract.number}) as n`,
      );
      const number = numbered?.n ?? '';
      const snapshot = buildActSnapshot({
        number,
        actDate: row.act.actDate as LocalDate,
        periodFrom: row.act.periodFrom as LocalDate | null,
        periodTo: row.act.periodTo as LocalDate | null,
        amountUah: row.act.amountUah,
        company: co,
        contract: {
          number: row.contract.number,
          signedOn: row.contract.signedOn as LocalDate | null,
        },
        payee: { ...row.payee, edrDate: row.payee.edrDate as LocalDate | null },
      });
      await tx
        .update(supplierAct)
        .set({ status: 'issued', number, snapshot })
        .where(eq(supplierAct.id, id));
      await enqueueJob(tx, renderActJob(id));
      return ok({ id, number });
    }),
});

export const voidAct = defineService({
  name: 'acts.void',
  input: z.object({ id: z.uuid(), reason: requiredText('field.voidReason') }),
  handler: async (ctx, { id, reason }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(supplierAct)
        .set({ status: 'void', voidReason: reason })
        .where(and(eq(supplierAct.id, id), eq(supplierAct.status, 'issued')))
        .returning({ id: supplierAct.id }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'acts.voidState'));
  },
});

/** After signing in Vchasno the act keeps a link to the signed document (6.6). */
export const setSignedUrl = defineService({
  name: 'acts.setSignedUrl',
  input: z.object({ id: z.uuid(), signedUrl: httpUrl }),
  handler: async (ctx, { id, signedUrl }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(supplierAct)
        .set({ signedUrl })
        .where(and(eq(supplierAct.id, id), eq(supplierAct.status, 'issued')))
        .returning({ id: supplierAct.id }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'acts.linkIssuedOnly'));
  },
});

export const fopContracts = defineService({
  name: 'acts.fopContracts',
  input: z.object({}),
  handler: async (ctx) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx
          .select({ id: contract.id, number: contract.number, payeeName })
          .from(contract)
          .innerJoin(payee, eq(payee.id, contract.payeeId))
          .where(eq(contract.kind, 'fop'))
          .orderBy(asc(payeeName)),
      ),
    ),
});
