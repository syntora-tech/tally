import type { DbTransaction } from '@tally/db';
import {
  allocation,
  company,
  contract,
  contractAnnex,
  contractorInvoice,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  timesheet,
  transaction,
} from '@tally/db/schema';
import { endOfMonth, roundHalfUp, sum, type LocalDate } from '@tally/domain';
import { and, asc, desc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { enqueueJob, type NewJob } from '../../jobs/queue';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { localDateString, optionalText, requiredText } from '../fields';
import { buildContractorInvoiceSnapshot, payeeSnapshot } from './snapshot';

export const DEFAULT_DESCRIPTION = {
  en: 'Software Development',
  ua: 'Розробка програмного забезпечення',
};

export const renderContractorInvoiceJob = (id: string): NewJob => ({
  kind: 'render_contractor_invoice',
  payload: { id },
  dedupeKey: `render_contractor_invoice:${id}`,
});

const payeeName = sql<string>`coalesce(${payee.legalNameEn}, ${payee.legalNameUa})`;

/** What the invoice of a payout says: its USD total and the hours paid (pay hours, else billed). */
async function payoutFigures(tx: DbTransaction, itemId: string) {
  const [row] = await tx
    .select({ item: payrollItem, month: period.month, payeeKind: payee.kind })
    .from(payrollItem)
    .innerJoin(period, eq(period.id, payrollItem.periodId))
    .leftJoin(payee, eq(payee.id, payrollItem.payeeId))
    .where(eq(payrollItem.id, itemId));
  if (!row) return err(serviceError('not_found', 'payroll.notFound'));
  const { item } = row;
  if (
    item.kind !== 'person' ||
    !item.payeeId ||
    row.payeeKind === 'fop' ||
    item.payoutMethod === 'fiat'
  ) {
    return err(serviceError('validation_error', 'contractorInvoices.notForPayout'));
  }
  const hours = await tx
    .select({ hours: sql<string>`coalesce(${timesheet.payHours}, ${timesheet.hours})` })
    .from(payrollLine)
    .innerJoin(timesheet, eq(timesheet.id, payrollLine.timesheetId))
    .where(and(eq(payrollLine.payrollItemId, itemId), eq(payrollLine.agencyFee, false)));
  const month = row.month as LocalDate;
  return ok({
    item,
    payeeId: item.payeeId,
    month,
    amount: roundHalfUp(item.totalUsd).toFixed(2),
    hours: hours.length ? sum(hours.map((h) => h.hours)).toFixed(2) : null,
  });
}

/** The payee's contract in force (latest signed, active first). */
async function contractOf(tx: DbTransaction, payeeId: string) {
  const [row] = await tx
    .select()
    .from(contract)
    .where(and(eq(contract.payeeId, payeeId), eq(contract.kind, 'fop')))
    .orderBy(asc(contract.status), desc(contract.signedOn))
    .limit(1);
  return row ?? null;
}

/** The newest annex of the contract that has started by the invoice period. */
async function annexOf(tx: DbTransaction, contractId: string, from: LocalDate | null) {
  const [row] = await tx
    .select({ number: contractAnnex.number })
    .from(contractAnnex)
    .where(
      and(
        eq(contractAnnex.contractId, contractId),
        eq(contractAnnex.kind, 'annex'),
        ne(contractAnnex.status, 'draft'),
        from ? or(isNull(contractAnnex.validFrom), lte(contractAnnex.validFrom, from)) : undefined,
      ),
    )
    .orderBy(desc(contractAnnex.validFrom), desc(contractAnnex.signedOn))
    .limit(1);
  return row ?? null;
}

/**
 * Drafts the invoice a contractor abroad issues to us for a payout (A-090), or brings an existing
 * draft up to date with the payout: amount = the payout's USD total, hours = the hours paid.
 */
export const draftContractorInvoice = defineService({
  name: 'contractorInvoices.draft',
  input: z.object({ payrollItemId: z.uuid() }),
  handler: (ctx, { payrollItemId }) =>
    inActorScope(ctx, async (tx) => {
      const figures = await payoutFigures(tx, payrollItemId);
      if (figures.isErr()) return err(figures.error);
      const { payeeId, month, amount, hours } = figures.value;
      const [existing] = await tx
        .select()
        .from(contractorInvoice)
        .where(
          and(
            eq(contractorInvoice.payrollItemId, payrollItemId),
            ne(contractorInvoice.status, 'void'),
          ),
        );
      if (existing && existing.status !== 'draft') return ok({ id: existing.id });
      if (existing) {
        await tx
          .update(contractorInvoice)
          .set({ amount, hours })
          .where(eq(contractorInvoice.id, existing.id));
        return ok({ id: existing.id });
      }
      const ct = await contractOf(tx, payeeId);
      if (!ct) return err(serviceError('validation_error', 'contractorInvoices.noContract'));
      const [row] = await tx
        .insert(contractorInvoice)
        .values({
          contractId: ct.id,
          payeeId,
          payrollItemId,
          invoiceDate: ctx.today,
          periodFrom: month,
          periodTo: endOfMonth(month),
          hours,
          amount,
          currency: 'USD',
          descriptionEn: DEFAULT_DESCRIPTION.en,
          descriptionUa: DEFAULT_DESCRIPTION.ua,
        })
        .returning({ id: contractorInvoice.id });
      return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
    }),
});

export const saveContractorInvoiceDraft = defineService({
  name: 'contractorInvoices.saveDraft',
  input: z.object({
    id: z.uuid(),
    invoiceDate: localDateString,
    descriptionEn: requiredText(),
    descriptionUa: requiredText(),
  }),
  handler: (ctx, { id, ...values }) =>
    inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .update(contractorInvoice)
        .set(values)
        .where(and(eq(contractorInvoice.id, id), eq(contractorInvoice.status, 'draft')))
        .returning({ id: contractorInvoice.id });
      return row ? ok(row) : err(serviceError('conflict', 'contractorInvoices.draftOnly'));
    }),
});

/** The contractor's numbering: the invoice date as DDMMYYYY, with "/n" when that one is taken. */
export function contractorInvoiceNumber(date: LocalDate, taken: readonly string[]) {
  const [y, m, d] = date.split('-');
  const base = `${d ?? ''}${m ?? ''}${y ?? ''}`;
  if (!taken.includes(base)) return base;
  let n = 1;
  while (taken.includes(`${base}/${String(n)}`)) n++;
  return `${base}/${String(n)}`;
}

/** Issue: the payout's latest figures, number, snapshot, render job — as for an act (6.6). */
export const issueContractorInvoice = defineService({
  name: 'contractorInvoices.issue',
  input: z.object({ id: z.uuid(), number: optionalText }),
  handler: (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select({ inv: contractorInvoice, contract, payee })
        .from(contractorInvoice)
        .innerJoin(contract, eq(contract.id, contractorInvoice.contractId))
        .innerJoin(payee, eq(payee.id, contractorInvoice.payeeId))
        .where(eq(contractorInvoice.id, input.id))
        .for('update', { of: contractorInvoice });
      if (!row) return err(serviceError('not_found', 'contractorInvoices.notFound'));
      if (row.inv.status !== 'draft') {
        return err(serviceError('conflict', 'contractorInvoices.draftOnly'));
      }
      let { amount, hours } = row.inv;
      if (row.inv.payrollItemId) {
        const figures = await payoutFigures(tx, row.inv.payrollItemId);
        if (figures.isErr()) return err(figures.error);
        ({ amount, hours } = figures.value);
      }
      const [co] = await tx.select().from(company).orderBy(asc(company.createdAt)).limit(1);
      if (!co) return err(serviceError('conflict', 'company.missingShort'));
      const taken = await tx
        .select({ number: contractorInvoice.number })
        .from(contractorInvoice)
        .where(
          and(
            eq(contractorInvoice.payeeId, row.inv.payeeId),
            ne(contractorInvoice.status, 'draft'),
          ),
        );
      const numbers = taken.map((t) => t.number ?? '');
      const number =
        input.number ?? contractorInvoiceNumber(row.inv.invoiceDate as LocalDate, numbers);
      if (numbers.includes(number)) {
        return err(
          serviceError('validation_error', msg('contractorInvoices.numberTaken', { number }), {
            number: [msg('contractorInvoices.numberTaken', { number })],
          }),
        );
      }
      const periodFrom = row.inv.periodFrom as LocalDate | null;
      const snapshot = buildContractorInvoiceSnapshot({
        number,
        invoiceDate: row.inv.invoiceDate as LocalDate,
        periodFrom,
        periodTo: row.inv.periodTo as LocalDate | null,
        hours,
        amount,
        currency: row.inv.currency,
        descriptionEn: row.inv.descriptionEn,
        descriptionUa: row.inv.descriptionUa,
        company: co,
        contract: {
          number: row.contract.number,
          signedOn: row.contract.signedOn as LocalDate | null,
        },
        annex: await annexOf(tx, row.contract.id, periodFrom),
        payee: row.payee,
      });
      await tx
        .update(contractorInvoice)
        .set({ status: 'issued', number, amount, hours, snapshot })
        .where(eq(contractorInvoice.id, input.id));
      await enqueueJob(tx, renderContractorInvoiceJob(input.id));
      return ok({ id: input.id, number });
    }),
});

export const voidContractorInvoice = defineService({
  name: 'contractorInvoices.void',
  input: z.object({ id: z.uuid(), reason: requiredText('field.voidReason') }),
  handler: async (ctx, { id, reason }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(contractorInvoice)
        .set({ status: 'void', voidReason: reason })
        .where(and(eq(contractorInvoice.id, id), eq(contractorInvoice.status, 'issued')))
        .returning({ id: contractorInvoice.id, payrollItemId: contractorInvoice.payrollItemId }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'contractorInvoices.voidState'));
  },
});

/**
 * Renders an issued invoice again, e.g. after the template layout changed (A-093): number and
 * figures stay; the new file becomes the next version of its document. The payee's requisites are
 * taken afresh from the payee card (A-094).
 */
export const rerenderContractorInvoice = defineService({
  name: 'contractorInvoices.rerender',
  input: z.object({ id: z.uuid(), reason: requiredText('field.reason') }),
  handler: async (ctx, { id, reason }) =>
    inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select({
          status: contractorInvoice.status,
          snapshot: contractorInvoice.snapshot,
          payee,
        })
        .from(contractorInvoice)
        .innerJoin(payee, eq(payee.id, contractorInvoice.payeeId))
        .where(eq(contractorInvoice.id, id))
        .for('update', { of: contractorInvoice });
      if (row?.status !== 'issued') {
        return err(serviceError('conflict', 'contractorInvoices.rerenderIssuedOnly'));
      }
      const snapshot = row.snapshot
        ? { ...(row.snapshot as Record<string, unknown>), payee: payeeSnapshot(row.payee) }
        : row.snapshot;
      await tx.execute(sql`select set_config('app.reason', ${reason}, true)`);
      await tx
        .update(contractorInvoice)
        .set({ pdfFileId: null, gdocFileId: null, snapshot })
        .where(eq(contractorInvoice.id, id));
      await enqueueJob(tx, renderContractorInvoiceJob(id));
      return ok({ id });
    }),
});

export const deleteContractorInvoiceDraft = defineService({
  name: 'contractorInvoices.deleteDraft',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .delete(contractorInvoice)
        .where(and(eq(contractorInvoice.id, id), eq(contractorInvoice.status, 'draft')))
        .returning({ id: contractorInvoice.id, payrollItemId: contractorInvoice.payrollItemId }),
    );
    return row ? ok(row) : err(serviceError('conflict', 'contractorInvoices.draftOnly'));
  },
});

export const getContractorInvoice = defineService({
  name: 'contractorInvoices.get',
  input: z.object({ id: z.uuid() }),
  handler: async (ctx, { id }) => {
    const found = await inActorScope(ctx, async (tx) => {
      const [row] = await tx
        .select({
          invoice: contractorInvoice,
          payeeName,
          contractNumber: contract.number,
          personName: person.fullName,
          month: period.month,
          payoutStatus: payrollItem.status,
          periodId: payrollItem.periodId,
        })
        .from(contractorInvoice)
        .innerJoin(payee, eq(payee.id, contractorInvoice.payeeId))
        .innerJoin(contract, eq(contract.id, contractorInvoice.contractId))
        .leftJoin(payrollItem, eq(payrollItem.id, contractorInvoice.payrollItemId))
        .leftJoin(person, eq(person.id, payrollItem.personId))
        .leftJoin(period, eq(period.id, payrollItem.periodId))
        .where(eq(contractorInvoice.id, id));
      if (!row) return null;
      // The payment step of the invoice (A-116): what paid its payout, from the Ledger.
      const payments = row.invoice.payrollItemId
        ? await tx
            .select({
              transactionId: transaction.id,
              occurredOn: transaction.occurredOn,
              amount: allocation.amount,
              currency: allocation.currency,
            })
            .from(allocation)
            .innerJoin(transaction, eq(transaction.id, allocation.transactionId))
            .where(eq(allocation.payrollItemId, row.invoice.payrollItemId))
            .orderBy(asc(transaction.occurredOn))
        : [];
      const { payoutStatus, periodId, ...rest } = row;
      return {
        ...rest,
        payout:
          row.invoice.payrollItemId && periodId && payoutStatus
            ? { itemId: row.invoice.payrollItemId, periodId, status: payoutStatus, payments }
            : null,
      };
    });
    return found ? ok(found) : err(serviceError('not_found', 'contractorInvoices.notFound'));
  },
});

export const listContractorInvoices = defineService({
  name: 'contractorInvoices.list',
  input: z.object({
    payeeId: z.uuid().optional(),
    payrollItemIds: z.array(z.uuid()).max(500).optional(),
    status: z.enum(['draft', 'issued', 'void']).optional(),
  }),
  handler: async (ctx, input) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: contractorInvoice.id,
          number: contractorInvoice.number,
          status: contractorInvoice.status,
          invoiceDate: contractorInvoice.invoiceDate,
          periodFrom: contractorInvoice.periodFrom,
          periodTo: contractorInvoice.periodTo,
          hours: contractorInvoice.hours,
          amount: contractorInvoice.amount,
          currency: contractorInvoice.currency,
          payeeId: contractorInvoice.payeeId,
          payeeName,
          contractNumber: contract.number,
          payrollItemId: contractorInvoice.payrollItemId,
          documentId: contractorInvoice.documentId,
          voidReason: contractorInvoice.voidReason,
          signedAt: contractorInvoice.signedAt,
          signedUrl: contractorInvoice.signedUrl,
        })
        .from(contractorInvoice)
        .innerJoin(payee, eq(payee.id, contractorInvoice.payeeId))
        .innerJoin(contract, eq(contract.id, contractorInvoice.contractId))
        .where(
          and(
            input.payeeId ? eq(contractorInvoice.payeeId, input.payeeId) : undefined,
            input.payrollItemIds
              ? inArray(contractorInvoice.payrollItemId, input.payrollItemIds)
              : undefined,
            input.status ? eq(contractorInvoice.status, input.status) : undefined,
          ),
        )
        .orderBy(desc(contractorInvoice.invoiceDate), desc(contractorInvoice.createdAt)),
    );
    return ok({ items: rows });
  },
});
