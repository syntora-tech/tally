import { assignment, invoice, invoiceLine, payrollLine, person } from '@tally/db/schema';
import { Decimal } from '@tally/domain';
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { loadUsdConverter } from './overview';

/**
 * "Кредитуємо клієнтів" (5.3, 9.4): pay released at the company's expense for work whose client
 * invoice is still not fully paid. Falls as clients pay late.
 */
export const creditToClients = defineService({
  name: 'dashboard.creditToClients',
  input: z.object({}),
  handler: async (ctx) => {
    const { rows, toUsd } = await inActorScope(ctx, async (tx) => ({
      toUsd: await loadUsdConverter(tx),
      rows: await tx
        .select({
          lineId: payrollLine.id,
          amount: payrollLine.amount,
          currency: payrollLine.currency,
          personName: person.fullName,
          invoiceNumber: invoice.number,
          invoiceId: invoice.id,
        })
        .from(payrollLine)
        // Through the assignment, so agency fee lines (A-068) count too.
        .innerJoin(assignment, eq(assignment.id, payrollLine.assignmentId))
        .innerJoin(person, eq(person.id, assignment.personId))
        .innerJoin(invoiceLine, eq(invoiceLine.id, payrollLine.fundedByInvoiceLineId))
        .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
        .where(
          and(
            eq(payrollLine.fundingSource, 'company'),
            inArray(payrollLine.status, ['payable', 'paid']),
            lt(invoice.paidAmount, invoice.total),
            ne(invoice.status, 'written_off'),
            sql`${invoice.status} <> 'void'`,
          ),
        ),
    }));
    // UAH pay counts at the latest stored rate (A-075); without one it is left out.
    const withUsd = rows.map((r) => ({
      ...r,
      amountUsd: toUsd(r.amount, r.currency)?.toFixed(2) ?? null,
    }));
    const totalUsd = withUsd.reduce((s, r) => s.plus(r.amountUsd ?? '0'), new Decimal(0));
    return ok({ totalUsd: totalUsd.toFixed(2), rows: withUsd });
  },
});
