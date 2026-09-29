import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { baseColumns, rolePolicies } from './_common';

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/**
 * Background work queue (spec 7.1, 10.4): the `jobs` cron takes one job per call. A job that
 * throws is retried with backoff up to `max_attempts`, then stays `failed` for a manual retry.
 */
export const job = pgTable(
  'job',
  {
    ...baseColumns,
    kind: text().notNull(),
    payload: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** At most one queued/running job per key, e.g. `render:invoice:<id>:<revision>`. */
    dedupeKey: text(),
    status: text().notNull().default('queued'),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    lastError: text(),
    runAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('job_status_check', sql`${t.status} in ('queued', 'running', 'done', 'failed')`),
    uniqueIndex('job_dedupe_key')
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('job_queue_idx')
      .on(t.runAfter)
      .where(sql`${t.status} = 'queued'`),
    ...rolePolicies('job', { read: 'finance', write: 'finance' }),
  ],
);

export type Job = typeof job.$inferSelect;
