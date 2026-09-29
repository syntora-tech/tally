import type { DbTransaction } from '@tally/db';
import { job } from '@tally/db/schema';

export type JobKind = 'render_invoice';

export type NewJob = { kind: JobKind; payload: Record<string, unknown>; dedupeKey?: string };

/** Queued in the caller's transaction, so a job exists only if the change it serves commits. */
export async function enqueueJob(tx: DbTransaction, { kind, payload, dedupeKey }: NewJob) {
  await tx
    .insert(job)
    .values({ kind, payload, dedupeKey: dedupeKey ?? null })
    .onConflictDoNothing();
}

export const renderInvoiceJob = (invoiceId: string, revision: number): NewJob => ({
  kind: 'render_invoice',
  payload: { invoiceId, revision },
  dedupeKey: `render_invoice:${invoiceId}:${String(revision)}`,
});
