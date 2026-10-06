import type { DbTransaction } from '@tally/db';
import {
  assignment,
  invoice,
  invoiceLine,
  period,
  person,
  supplierAct,
  timesheet,
} from '@tally/db/schema';
import { and, eq, gte, inArray, notInArray } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { msg, serviceError, type ServiceError } from '../errors';
import { refreshEarlyActs, refreshEarlyInvoices } from '../periods/early';

/**
 * Terms of open months may change (closed ones are guarded by I10), but not under a document that
 * is already issued for them (A-076, A-077). Drafts of those months follow the new terms.
 */
export async function applyTermsChange(
  tx: DbTransaction,
  side: 'billing' | 'pay',
  assignmentId: string,
  fromMonth: string,
): Promise<Result<null, ServiceError>> {
  const open = await tx
    .select()
    .from(period)
    .where(and(eq(period.status, 'open'), gte(period.month, fromMonth)));
  if (!open.length) return ok(null);
  const periodIds = open.map((p) => p.id);

  if (side === 'billing') {
    const [issued] = await tx
      .select({ number: invoice.number })
      .from(invoiceLine)
      .innerJoin(invoice, eq(invoice.id, invoiceLine.invoiceId))
      .innerJoin(timesheet, eq(timesheet.id, invoiceLine.timesheetId))
      .where(
        and(
          eq(timesheet.assignmentId, assignmentId),
          inArray(invoice.periodId, periodIds),
          notInArray(invoice.status, ['draft', 'void']),
        ),
      );
    if (issued) {
      return err(
        serviceError('conflict', msg('assignments.termsInvoiced', { number: issued.number ?? '' })),
      );
    }
  } else {
    const [issued] = await tx
      .select({ number: supplierAct.number })
      .from(assignment)
      .innerJoin(person, eq(person.id, assignment.personId))
      .innerJoin(supplierAct, eq(supplierAct.payeeId, person.defaultPayeeId))
      .where(
        and(
          eq(assignment.id, assignmentId),
          eq(supplierAct.type, 'monthly'),
          eq(supplierAct.status, 'issued'),
          inArray(
            supplierAct.periodFrom,
            open.map((p) => p.month),
          ),
        ),
      );
    if (issued) {
      return err(
        serviceError('conflict', msg('assignments.termsActed', { number: issued.number ?? '' })),
      );
    }
  }

  for (const p of open) {
    if (side === 'billing') {
      const refreshed = await refreshEarlyInvoices(tx, p);
      if (refreshed.isErr()) return err(refreshed.error);
    } else {
      await refreshEarlyActs(tx, p);
    }
  }
  return ok(null);
}
