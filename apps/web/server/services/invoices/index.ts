import type { DbTransaction } from '@tally/db';
import {
  client,
  company,
  contract,
  document,
  documentLink,
  invoice,
  invoiceLine,
  invoiceRevision,
  job,
  period,
} from '@tally/db/schema';
import {
  defaultInvoiceDate,
  diffDays,
  dueDate,
  roundHalfUp,
  sum,
  toDecimal,
  type InvoiceDateRule,
  type LocalDate,
  type PaymentDueRule,
} from '@tally/domain';
import { and, asc, desc, eq, inArray, isNotNull, ne, notExists, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { enqueueJob, renderInvoiceJob } from '../../jobs/queue';
import { inActorScope, type ServiceContext } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { localDateString, nonNegativeDecimal, optionalText, requiredText } from '../fields';
import { loadCalendar } from '../periods';
import { buildInvoiceSnapshot } from './snapshot';

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'void',
  'written_off',
] as const;
const DEFAULT_SEQUENCE = 'invoice';

const clientLabel = sql<string>`coalesce(${client.shortName}, ${client.legalName})`;

export const listInvoices = defineService({
  name: 'invoices.list',
  input: z.object({
    status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(INVOICE_STATUSES).optional()),
  }),
  handler: async (ctx, { status }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: invoice.id,
          number: invoice.number,
          status: invoice.status,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          currency: invoice.currency,
          total: invoice.total,
          paidAmount: invoice.paidAmount,
          revision: invoice.revision,
          isLegacy: invoice.isLegacy,
          clientName: clientLabel,
          periodMonth: period.month,
        })
        .from(invoice)
        .innerJoin(client, eq(client.id, invoice.clientId))
        .leftJoin(period, eq(period.id, invoice.periodId))
        .where(status ? eq(invoice.status, status) : undefined)
        .orderBy(desc(invoice.issueDate), desc(invoice.createdAt)),
    );
    return ok(
      rows.map((r) => {
        const open = r.status === 'issued' || r.status === 'partially_paid';
        return {
          ...r,
          remaining: toDecimal(r.total).minus(r.paidAmount).toFixed(2),
          overdueDays: open ? Math.max(0, diffDays(r.dueDate as LocalDate, ctx.today)) : 0,
        };
      }),
    );
  },
});

async function loadInvoice(tx: DbTransaction, id: string) {
  const [row] = await tx
    .select({ invoice, contract, client, periodMonth: period.month })
    .from(invoice)
    .innerJoin(contract, eq(contract.id, invoice.contractId))
    .innerJoin(client, eq(client.id, invoice.clientId))
    .leftJoin(period, eq(period.id, invoice.periodId))
    .where(eq(invoice.id, id))
    .for('update', { of: invoice });
  return row ?? null;
}

export const getInvoice = defineService({
  name: 'invoices.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const card = await inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select({
          invoice,
          contractNumber: contract.number,
          contract,
          clientName: clientLabel,
          periodMonth: period.month,
          periodId: period.id,
        })
        .from(invoice)
        .innerJoin(contract, eq(contract.id, invoice.contractId))
        .innerJoin(client, eq(client.id, invoice.clientId))
        .leftJoin(period, eq(period.id, invoice.periodId))
        .where(eq(invoice.id, id));
      if (!row) return null;
      const lines = await tx
        .select()
        .from(invoiceLine)
        .where(eq(invoiceLine.invoiceId, id))
        .orderBy(asc(invoiceLine.position));
      const revisions = await tx
        .select()
        .from(invoiceRevision)
        .where(eq(invoiceRevision.invoiceId, id))
        .orderBy(desc(invoiceRevision.revision));
      const signed = await tx
        .select({
          id: document.id,
          title: document.title,
          signedAt: document.signedAt,
          sourceRevision: document.sourceRevision,
        })
        .from(document)
        .innerJoin(documentLink, eq(documentLink.documentId, document.id))
        .where(
          and(
            eq(documentLink.entityType, 'invoice'),
            eq(documentLink.entityId, id),
            isNotNull(document.signedAt),
          ),
        )
        .orderBy(desc(document.signedAt));
      return { ...row, lines, revisions, signed };
    });
    return card ? ok(card) : err(serviceError('not_found', 'Інвойс не знайдено'));
  },
});

const lineInput = z.object({
  id: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  descriptionEn: requiredText('Опис англійською'),
  descriptionUa: requiredText('Опис українською'),
  quantity: nonNegativeDecimal,
  unitPrice: nonNegativeDecimal,
});

export const saveInvoiceInput = z.object({
  id: z.uuid(),
  issueDate: localDateString,
  dateOverrideReason: optionalText,
  lines: z.array(lineInput).min(1, 'Потрібен хоча б один рядок').max(100),
  /** Required when revising an issued invoice (A-044). */
  reason: optionalText,
});

async function companyRow(tx: DbTransaction) {
  const [co] = await tx.select().from(company).orderBy(asc(company.createdAt)).limit(1);
  return co ?? null;
}

async function replaceLines(
  tx: DbTransaction,
  invoiceId: string,
  lines: z.output<typeof lineInput>[],
) {
  const existing = await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  const timesheetOf = new Map(existing.map((l) => [l.id, l.timesheetId]));
  await tx.delete(invoiceLine).where(eq(invoiceLine.invoiceId, invoiceId));
  const rows = lines.map((l, i) => ({
    invoiceId,
    timesheetId: (l.id && timesheetOf.get(l.id)) ?? null,
    position: i + 1,
    descriptionEn: l.descriptionEn,
    descriptionUa: l.descriptionUa,
    quantity: toDecimal(l.quantity).toFixed(2),
    unitPrice: toDecimal(l.unitPrice).toFixed(8),
    amount: roundHalfUp(toDecimal(l.quantity).times(l.unitPrice)).toFixed(2),
  }));
  await tx.insert(invoiceLine).values(rows);
  return { rows, total: sum(rows.map((r) => r.amount)).toFixed(2) };
}

function snapshotFor(
  row: NonNullable<Awaited<ReturnType<typeof loadInvoice>>>,
  co: NonNullable<Awaited<ReturnType<typeof companyRow>>>,
  values: {
    number: string;
    issueDate: LocalDate;
    dueDate: LocalDate;
    revision: number;
    total: string;
  },
  lines: {
    descriptionEn: string;
    descriptionUa: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }[],
) {
  return buildInvoiceSnapshot({
    ...values,
    currency: row.invoice.currency,
    company: co,
    client: row.client,
    contract: { number: row.contract.number, signedOn: row.contract.signedOn as LocalDate | null },
    periodMonth: row.periodMonth as LocalDate | null,
    lines,
  });
}

/**
 * Edits a draft, or revises an issued invoice with no payments keeping its number (A-044). Changing
 * the date recomputes the due date from the contract rule (5.5).
 */
export const saveInvoice = defineService({
  name: 'invoices.save',
  input: saveInvoiceInput,
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const row = await loadInvoice(tx, input.id);
      if (!row) return err(serviceError('not_found', 'Інвойс не знайдено'));
      const inv = row.invoice;
      const revising = inv.status !== 'draft';
      if (revising && !(inv.status === 'issued' && toDecimal(inv.paidAmount).isZero())) {
        return err(
          serviceError(
            'conflict',
            'Оплачений інвойс змінити не можна — лише анулювати й перевипустити',
          ),
        );
      }
      if (revising && !input.reason) {
        return err(
          serviceError('validation_error', 'Вкажіть причину зміни', {
            reason: ['Вкажіть причину зміни'],
          }),
        );
      }
      if (revising) await tx.execute(sql`select set_config('app.reason', ${input.reason}, true)`);

      const due = dueDate(row.contract.paymentDueRule as PaymentDueRule, input.issueDate);
      const { rows, total } = await replaceLines(tx, inv.id, input.lines);
      const base = {
        issueDate: input.issueDate,
        dueDate: due,
        total,
        dateOverrideReason: input.dateOverrideReason,
      };
      if (!revising) {
        await tx.update(invoice).set(base).where(eq(invoice.id, inv.id));
        return ok({ id: inv.id, revision: inv.revision });
      }
      const co = await companyRow(tx);
      if (!co)
        return err(serviceError('conflict', 'Спершу заповніть реквізити компанії в Налаштуваннях'));
      const revision = inv.revision + 1;
      await tx
        .update(invoice)
        .set({
          ...base,
          revision,
          snapshot: snapshotFor(
            row,
            co,
            { number: inv.number ?? '', issueDate: input.issueDate, dueDate: due, revision, total },
            rows,
          ),
          pdfFileId: null,
          gdocFileId: null,
        })
        .where(eq(invoice.id, inv.id));
      await enqueueJob(tx, renderInvoiceJob(inv.id, revision));
      return ok({ id: inv.id, revision });
    }),
});

/** Issue dialog data (6.5): date by rule, recomputed due, working-day and ordering warnings. */
export const issuePreview = defineService({
  name: 'invoices.issuePreview',
  input: z.object({ id: z.uuid(), issueDate: localDateString.optional() }),
  handler: async (ctx, { id, issueDate }) =>
    inActorScope(ctx, async (tx) => {
      const row = await loadInvoice(tx, id);
      if (!row) return err(serviceError('not_found', 'Інвойс не знайдено'));
      const cal = await loadCalendar(tx);
      const suggested = row.periodMonth
        ? defaultInvoiceDate(
            row.contract.invoiceDateRule as InvoiceDateRule,
            row.periodMonth as LocalDate,
            cal,
          )
        : (row.invoice.issueDate as LocalDate);
      const date = issueDate ?? (row.invoice.issueDate as LocalDate);
      const sequenceKey = row.contract.numberSequenceKey ?? DEFAULT_SEQUENCE;
      const [previous] = await tx
        .select({ issueDate: invoice.issueDate, number: invoice.number })
        .from(invoice)
        .innerJoin(contract, eq(contract.id, invoice.contractId))
        .where(
          and(
            ne(invoice.status, 'draft'),
            ne(invoice.id, id),
            sql`coalesce(${contract.numberSequenceKey}, ${DEFAULT_SEQUENCE}) = ${sequenceKey}`,
          ),
        )
        .orderBy(desc(invoice.issueDate))
        .limit(1);
      return ok({
        suggestedDate: suggested,
        issueDate: date,
        dueDate: dueDate(row.contract.paymentDueRule as PaymentDueRule, date),
        isWorkingDay: cal.isWorkingDay(date),
        sequenceKey,
        previous: previous ?? null,
        earlierThanPrevious: previous ? date < previous.issueDate : false,
      });
    }),
});

/**
 * Issue (6.5, 7.1): number from the contract's sequence at issue time (D10, I2), frozen snapshot,
 * status issued — all in one transaction. PDF rendering is queued separately.
 */
export const issueInvoice = defineService({
  name: 'invoices.issue',
  input: z.object({ id: z.uuid(), issueDate: localDateString, dateOverrideReason: optionalText }),
  handler: async (ctx, { id, issueDate, dateOverrideReason }) =>
    inActorScope(ctx, async (tx) => {
      const row = await loadInvoice(tx, id);
      if (!row) return err(serviceError('not_found', 'Інвойс не знайдено'));
      if (row.invoice.status !== 'draft')
        return err(serviceError('conflict', 'Інвойс уже випущено'));
      const lines = await tx
        .select()
        .from(invoiceLine)
        .where(eq(invoiceLine.invoiceId, id))
        .orderBy(asc(invoiceLine.position));
      if (lines.length === 0)
        return err(serviceError('validation_error', 'Інвойс без рядків не можна випустити'));
      const co = await companyRow(tx);
      if (!co)
        return err(serviceError('conflict', 'Спершу заповніть реквізити компанії в Налаштуваннях'));

      const due = dueDate(row.contract.paymentDueRule as PaymentDueRule, issueDate);
      const total = sum(lines.map((l) => l.amount)).toFixed(2);
      const [numbered] = await tx.execute<{ n: string }>(
        sql`select public.issue_number(${row.contract.numberSequenceKey ?? DEFAULT_SEQUENCE}, ${issueDate}::date, ${row.contract.number}) as n`,
      );
      const number = numbered?.n ?? '';
      await tx
        .update(invoice)
        .set({
          status: 'issued',
          number,
          issueDate,
          dueDate: due,
          total,
          dateOverrideReason,
          snapshot: snapshotFor(
            row,
            co,
            { number, issueDate, dueDate: due, revision: row.invoice.revision, total },
            lines,
          ),
        })
        .where(eq(invoice.id, id));
      await enqueueJob(tx, renderInvoiceJob(id, row.invoice.revision));
      return ok({ id, number });
    }),
});

export const voidInvoice = defineService({
  name: 'invoices.void',
  input: z.object({ id: z.uuid(), reason: requiredText('Вкажіть причину анулювання') }),
  handler: async (ctx, { id, reason }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(invoice)
        .set({ status: 'void', voidReason: reason })
        .where(and(eq(invoice.id, id), inArray(invoice.status, ['issued', 'partially_paid'])))
        .returning({ id: invoice.id }),
    );
    return row
      ? ok(row)
      : err(
          serviceError(
            'conflict',
            'Анулювати можна лише випущений неоплачений або частково оплачений інвойс',
          ),
        );
  },
});

/** "Перевипустити" (6.5): a draft copy of a void invoice that takes over its hours. */
export const reissueInvoice = defineService({
  name: 'invoices.reissue',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const row = await loadInvoice(tx, id);
      if (!row) return err(serviceError('not_found', 'Інвойс не знайдено'));
      if (row.invoice.status !== 'void')
        return err(serviceError('conflict', 'Перевипустити можна лише анульований інвойс'));
      const lines = await tx
        .select()
        .from(invoiceLine)
        .where(eq(invoiceLine.invoiceId, id))
        .orderBy(asc(invoiceLine.position));
      await tx.update(invoiceLine).set({ timesheetId: null }).where(eq(invoiceLine.invoiceId, id));
      const {
        clientId,
        contractId,
        periodId,
        issueDate,
        dueDate: due,
        currency,
        total,
      } = row.invoice;
      const [copy] = await tx
        .insert(invoice)
        .values({ clientId, contractId, periodId, issueDate, dueDate: due, currency, total })
        .returning({ id: invoice.id });
      if (!copy) throw new Error('Invoice copy insert returned no row');
      if (lines.length) {
        await tx
          .insert(invoiceLine)
          .values(
            lines.map(
              ({
                id: _id,
                invoiceId: _inv,
                createdAt: _c,
                updatedAt: _u,
                createdBy: _b,
                ...l
              }) => ({ ...l, invoiceId: copy.id }),
            ),
          );
      }
      return ok(copy);
    }),
});

export async function currentInvoiceDocument(tx: DbTransaction, invoiceId: string) {
  const next = alias(document, 'next_version');
  const [doc] = await tx
    .select({ id: document.id, version: document.version })
    .from(document)
    .innerJoin(documentLink, eq(documentLink.documentId, document.id))
    .where(
      and(
        eq(document.type, 'invoice'),
        eq(documentLink.entityType, 'invoice'),
        eq(documentLink.entityId, invoiceId),
        notExists(tx.select({ id: next.id }).from(next).where(eq(next.supersedesId, document.id))),
      ),
    )
    .orderBy(desc(document.createdAt))
    .limit(1);
  return doc ?? null;
}

/** What a signed copy (A-039) needs: it supersedes the current file and records the revision. */
export function signedCopyTarget(ctx: ServiceContext, invoiceId: string) {
  return inActorScope(ctx, async (tx) => {
    const [row] = await tx.select().from(invoice).where(eq(invoice.id, invoiceId));
    if (!row || row.status === 'draft' || !row.number) return null;
    return {
      number: row.number,
      revision: row.revision,
      clientId: row.clientId,
      issueDate: row.issueDate as LocalDate,
      current: await currentInvoiceDocument(tx, invoiceId),
    };
  });
}

/** "Перегенерувати" (7.1): queues a render of the current revision when its PDF is missing. */
export const regenerateInvoicePdf = defineService({
  name: 'invoices.regeneratePdf',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) =>
    inActorScope(ctx, async (tx) => {
      const [row] = await tx.select().from(invoice).where(eq(invoice.id, id));
      if (!row || row.status === 'draft' || row.status === 'void') {
        return err(serviceError('conflict', 'PDF генерується лише для випущеного інвойсу'));
      }
      if (row.pdfFileId) return err(serviceError('conflict', 'PDF цієї редакції вже є'));
      await enqueueJob(tx, renderInvoiceJob(id, row.revision));
      return ok({ id });
    }),
});

/** Latest render job of the invoice for the card: queued, running, failed with the error. */
export const invoiceRenderStatus = defineService({
  name: 'invoices.renderStatus',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({
          status: job.status,
          lastError: job.lastError,
          attempts: job.attempts,
          revision: sql<number>`(${job.payload} ->> 'revision')::int`,
        })
        .from(job)
        .where(and(eq(job.kind, 'render_invoice'), sql`${job.payload} ->> 'invoiceId' = ${id}`))
        .orderBy(desc(job.createdAt))
        .limit(1),
    );
    return ok(row ?? null);
  },
});
