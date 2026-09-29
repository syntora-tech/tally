import type { Db } from '@tally/db';
import { job } from '@tally/db/schema';
import { eq, sql } from 'drizzle-orm';
import { withSystem } from '../db/with-user';

export type JobHandler = (payload: unknown, db: Db) => Promise<unknown>;

type Claimed = {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

export type JobRun = {
  id: string;
  kind: string;
  status: 'done' | 'queued' | 'failed';
  error?: string;
};

/** Retry delay after the n-th failed attempt: 1, 2, 4… minutes. */
export const backoffMinutes = (attempts: number) => 2 ** Math.max(0, attempts - 1);

/**
 * One job per call (spec 10.4). The claim commits first so a crash leaves the job `running` until
 * `claim_job()` requeues it; the handler runs outside any transaction (it may call Google APIs).
 */
export async function runNextJob(
  db: Db,
  handlers: Record<string, JobHandler>,
): Promise<JobRun | null> {
  const claimed = await withSystem(db, 'system:jobs', async (tx) => {
    const rows = await tx.execute<Claimed>(
      sql`select id, kind, payload, attempts, max_attempts from public.claim_job()`,
    );
    return rows[0] ?? null;
  });
  if (!claimed) return null;

  const finish = (values: Partial<typeof job.$inferInsert>) =>
    withSystem(db, 'system:jobs', (tx) => tx.update(job).set(values).where(eq(job.id, claimed.id)));

  try {
    const handler = handlers[claimed.kind];
    if (!handler) throw new Error(`No handler for job kind ${claimed.kind}`);
    await handler(claimed.payload, db);
    await finish({ status: 'done', finishedAt: new Date(), lastError: null });
    return { id: claimed.id, kind: claimed.kind, status: 'done' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = claimed.attempts >= claimed.max_attempts;
    await finish({
      status: failed ? 'failed' : 'queued',
      lastError: message.slice(0, 2000),
      finishedAt: failed ? new Date() : null,
      runAfter: failed
        ? undefined
        : new Date(Date.now() + backoffMinutes(claimed.attempts) * 60_000),
    });
    return {
      id: claimed.id,
      kind: claimed.kind,
      status: failed ? 'failed' : 'queued',
      error: message,
    };
  }
}
