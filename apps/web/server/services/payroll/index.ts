import {
  account,
  adjustment,
  allocation,
  assignment,
  category,
  client,
  contract,
  invoice,
  invoiceLine,
  payee,
  payrollItem,
  payrollLine,
  payTerms,
  period,
  person,
} from '@tally/db/schema';
import {
  effectiveVersion,
  payoutDeadline,
  payrollTotalUah,
  sum,
  toDecimal,
  type LocalDate,
} from '@tally/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { ensureMonthlyActDraft } from '../acts';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError, msg } from '../errors';
import { decimalString, localDateString, optionalText } from '../fields';
import { bookTransaction } from '../ledger';
import { loadCalendar } from '../periods';
import { refreshPayability } from './payability';

const USD_LIKE = ['USD', 'USDT', 'USDC'];

export type PayrollGroup = 'ready' | 'waiting' | 'paid';

/** Payroll queue (6.6): statuses are refreshed for today first, so deadlines show up at once. */
export const listPayroll = defineService({
  name: 'payroll.list',
  input: z.object({
    periodId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  }),
  handler: async (ctx, { periodId }) => {
    await refreshPayability(ctx.db, ctx.today);
    const data = await inActorScope(ctx, async (tx) => {
      const items = await tx
        .select({
          item: payrollItem,
          personName: person.fullName,
          payeeName: sql<string | null>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`,
          payeeKind: payee.kind,
          month: period.month,
        })
        .from(payrollItem)
        .innerJoin(person, eq(person.id, payrollItem.personId))
        .innerJoin(period, eq(period.id, payrollItem.periodId))
        .leftJoin(payee, eq(payee.id, payrollItem.payeeId))
        .where(periodId ? eq(payrollItem.periodId, periodId) : undefined)
        .orderBy(desc(period.month), asc(person.fullName));
      const itemIds = items.map((i) => i.item.id);
      const cal = await loadCalendar(tx);
      if (itemIds.length === 0) return { items: [], lines: [], adjustments: [], terms: [], cal };
      const lines = await tx
        .select({
          line: payrollLine,
          clientName: sql<string | null>`coalesce(${client.shortName}, ${client.legalName})`,
          roleTitle: assignment.roleTitle,
          invoiceNumber: invoice.number,
          invoiceStatus: invoice.status,
          dueDate: invoice.dueDate,
        })
        .from(payrollLine)
        .innerJoin(assignment, eq(assignment.id, payrollLine.assignmentId))
        .leftJoin(contract, eq(contract.id, assignment.contractId))
        .leftJoin(client, eq(client.id, contract.clientId))
        .leftJoin(invoiceLine, eq(invoiceLine.id, payrollLine.fundedByInvoiceLineId))
        .leftJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
        .where(inArray(payrollLine.payrollItemId, itemIds));
      const adjustments = await tx
        .select()
        .from(adjustment)
        .where(
          inArray(
            adjustment.periodId,
            items.map((i) => i.item.periodId),
          ),
        );
      const terms = await tx
        .select()
        .from(payTerms)
        .where(
          inArray(
            payTerms.assignmentId,
            lines.map((l) => l.line.assignmentId),
          ),
        );
      return { items, lines, adjustments, terms, cal };
    });

    const rows = data.items.map(({ item, ...rest }) => {
      const lines = data.lines
        .filter((l) => l.line.payrollItemId === item.id)
        .map((l) => {
          const version = effectiveVersion(
            data.terms
              .filter((t) => t.assignmentId === l.line.assignmentId)
              .map((t) => ({ ...t, validFrom: t.validFrom as LocalDate })),
            rest.month as LocalDate,
          );
          return {
            ...l.line,
            clientName: l.clientName,
            roleTitle: l.roleTitle,
            invoiceNumber: l.invoiceNumber,
            deadline: l.dueDate
              ? payoutDeadline(l.dueDate as LocalDate, version?.graceDays ?? 0, data.cal)
              : null,
          };
        });
      const adjustments = data.adjustments.filter(
        (a) =>
          a.periodId === item.periodId &&
          a.personId === item.personId &&
          a.payoutMethod === item.payoutMethod,
      );
      const currency = item.payoutMethod === 'fiat' ? 'UAH' : 'USD';
      const total = item.payoutMethod === 'fiat' ? item.totalUah : item.totalUsd;
      const remaining = total === null ? null : toDecimal(total).minus(item.paidAmount).toFixed(2);
      const group: PayrollGroup =
        item.status === 'paid' ? 'paid' : item.status === 'draft' ? 'waiting' : 'ready';
      return {
        item,
        ...rest,
        lines,
        adjustments,
        currency,
        remaining,
        group,
        payableUsd: sum(
          lines
            .filter((l) => l.status === 'payable' || l.status === 'paid')
            .map((l) => l.amountUsd),
        ).toFixed(2),
        nextDeadline:
          lines
            .filter((l) => l.status === 'awaiting_client' && l.deadline)
            .map((l) => l.deadline ?? '')
            .sort()[0] ?? null,
      };
    });
    return ok(rows);
  },
});

/**
 * Fiat payout rate (5.4): snapshot of rate, source, who and when; total_uah per 5.2. Fixed once
 * money has been paid against the item.
 */
export const setPayoutRate = defineService({
  name: 'payroll.setRate',
  input: z.object({
    itemId: z.uuid(),
    rate: decimalString.refine((v) => toDecimal(v).gt(0), 'fx.ratePositive2'),
    source: z.enum(['bank_actual', 'nbu', 'manual']).default('manual'),
  }),
  handler: async (ctx, input) => inActorScope(ctx, (tx) => applyRate(tx, ctx, input)),
});

async function applyRate(
  tx: Parameters<Parameters<typeof inActorScope>[1]>[0],
  ctx: Parameters<typeof inActorScope>[0],
  input: { itemId: string; rate: string; source: 'bank_actual' | 'nbu' | 'manual' },
) {
  const [item] = await tx
    .select()
    .from(payrollItem)
    .where(eq(payrollItem.id, input.itemId))
    .for('update');
  if (!item) return err(serviceError('not_found', 'payroll.notFound'));
  if (item.payoutMethod !== 'fiat') {
    return err(serviceError('validation_error', 'payroll.rateUahOnly'));
  }
  if (!toDecimal(item.paidAmount).isZero()) {
    return err(serviceError('conflict', 'payroll.rateLocked'));
  }
  const lines = await tx
    .select({ amountUsd: payrollLine.amountUsd })
    .from(payrollLine)
    .where(eq(payrollLine.payrollItemId, item.id));
  const adjustments = await tx
    .select({ amount: adjustment.amount, currency: adjustment.currency })
    .from(adjustment)
    .where(
      and(
        eq(adjustment.periodId, item.periodId),
        eq(adjustment.personId, item.personId),
        eq(adjustment.payoutMethod, item.payoutMethod),
      ),
    );
  const totalUah = payrollTotalUah(
    lines.map((l) => l.amountUsd),
    adjustments,
    input.rate,
  );
  if (totalUah.isErr()) {
    return err(
      serviceError(
        'validation_error',
        msg('payroll.unsupportedCurrency', { currency: totalUah.error.currency }),
      ),
    );
  }
  await tx
    .update(payrollItem)
    .set({
      payoutFxRate: toDecimal(input.rate).toFixed(6),
      fxSource: input.source,
      fxSetBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
      fxSetAt: new Date(),
      totalUah: totalUah.value.toFixed(2),
    })
    .where(eq(payrollItem.id, item.id));
  return ok({ id: item.id, totalUah: totalUah.value.toFixed(2) });
}

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const payItemInput = z.object({
  itemId: z.uuid(),
  accountId: z.uuid({ error: 'ledger.chooseFromAccount' }),
  occurredOn: localDateString,
  amount: decimalString.refine((v) => toDecimal(v).gt(0), 'field.positive'),
  rate: z.preprocess(emptyToUndefined, decimalString.optional()),
  rateSource: z.preprocess(emptyToUndefined, z.enum(['bank_actual', 'nbu', 'manual']).optional()),
  categoryName: z.enum(['Contractors', 'Payroll']).default('Contractors'),
  description: optionalText,
  /** Paying more than the payable part is an advance: owner only, with a reason (5.3 rule 6). */
  overrideReason: optionalText,
});

/**
 * "Виплатити" (6.6): optional rate, an expense from the chosen account and its allocation to the
 * item, in one transaction. Fiat items are paid from UAH accounts, crypto from USD-pegged wallets.
 */
export const payItem = defineService({
  name: 'payroll.pay',
  input: payItemInput,
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      if (input.rate) {
        const [current] = await tx
          .select({ rate: payrollItem.payoutFxRate, source: payrollItem.fxSource })
          .from(payrollItem)
          .where(eq(payrollItem.id, input.itemId));
        const same =
          current?.rate &&
          toDecimal(current.rate).eq(toDecimal(input.rate)) &&
          current.source === (input.rateSource ?? 'manual');
        if (!same) {
          const applied = await applyRate(tx, ctx, {
            itemId: input.itemId,
            rate: input.rate,
            source: input.rateSource ?? 'manual',
          });
          if (applied.isErr()) return err(applied.error);
        }
      }
      const [item] = await tx
        .select({ item: payrollItem, personName: person.fullName })
        .from(payrollItem)
        .innerJoin(person, eq(person.id, payrollItem.personId))
        .where(eq(payrollItem.id, input.itemId));
      if (!item) return err(serviceError('not_found', 'payroll.notFound'));
      const fiat = item.item.payoutMethod === 'fiat';
      const [acc] = await tx.select().from(account).where(eq(account.id, input.accountId));
      if (!acc) return err(serviceError('not_found', 'ledger.accountNotFound'));
      const accountOk = fiat ? acc.currency === 'UAH' : USD_LIKE.includes(acc.currency);
      if (!accountOk) {
        return err(
          serviceError('validation_error', 'payroll.accountCurrency', {
            accountId: [fiat ? 'payroll.chooseUahAccount' : 'payroll.chooseUsdAccount'],
          }),
        );
      }

      const lines = await tx
        .select({ status: payrollLine.status, amountUsd: payrollLine.amountUsd })
        .from(payrollLine)
        .where(eq(payrollLine.payrollItemId, item.item.id));
      const allReady = lines.every((l) => l.status === 'payable' || l.status === 'paid');
      const total = fiat ? item.item.totalUah : item.item.totalUsd;
      if (total === null) return err(serviceError('validation_error', 'payroll.rateFirst'));
      const payableUsd = sum(
        lines.filter((l) => l.status === 'payable' || l.status === 'paid').map((l) => l.amountUsd),
      );
      const payable = allReady
        ? toDecimal(total)
        : fiat
          ? payableUsd.times(toDecimal(item.item.payoutFxRate ?? '0'))
          : payableUsd;
      const after = toDecimal(item.item.paidAmount).plus(input.amount);
      if (after.gt(payable.toDecimalPlaces(2)) && !input.overrideReason) {
        return err(
          serviceError('validation_error', 'payroll.advanceReason', {
            overrideReason: ['payroll.advanceReasonField'],
          }),
        );
      }
      if (
        after.gt(payable.toDecimalPlaces(2)) &&
        !(ctx.actor.kind === 'user' && ctx.actor.role === 'owner')
      ) {
        return err(serviceError('forbidden', 'payroll.advanceOwnerOnly'));
      }

      const [cat] = await tx
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.txType, 'expense'), eq(category.name, input.categoryName)));
      if (!cat)
        return err(
          serviceError('not_found', msg('payroll.noCategory', { category: input.categoryName })),
        );
      const booked = await bookTransaction(tx, {
        type: 'expense',
        occurredOn: input.occurredOn,
        categoryId: cat.id,
        description:
          [input.description, input.overrideReason && `Advance: ${input.overrideReason}`]
            .filter(Boolean)
            .join(' · ') || null,
        counterparty: item.personName,
        externalRef: null,
        from: { accountId: acc.id, amount: input.amount },
        to: undefined,
        fee: undefined,
      });
      await tx.insert(allocation).values({
        transactionId: booked.id,
        payrollItemId: item.item.id,
        amount: input.amount,
        currency: fiat ? 'UAH' : acc.currency,
      });
      const act = fiat ? await ensureMonthlyActDraft(tx, item.item.id) : null;
      return ok({ id: item.item.id, transactionId: booked.id, actId: act?.id ?? null });
    }),
});
