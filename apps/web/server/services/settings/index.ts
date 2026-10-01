import { contract, job, numberSequence, workCalendarException } from '@tally/db/schema';
import { formatSequenceNumber } from '@tally/domain';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { checkbox, localDateString, requiredText } from '../fields';

const FORBIDDEN = serviceError('forbidden', 'settings.ownerOnly');

export const listCalendarExceptions = defineService({
  name: 'settings.calendar.list',
  input: z.object({}),
  handler: async (ctx) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx.select().from(workCalendarException).orderBy(asc(workCalendarException.onDate)),
      ),
    ),
});

/** Holidays off, weekends on (5.5); one row per date, a new save replaces the old one. */
export const saveCalendarException = defineService({
  name: 'settings.calendar.save',
  input: z.object({
    onDate: localDateString,
    isWorking: checkbox,
    reason: requiredText('settings.calendarReason'),
  }),
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .insert(workCalendarException)
        .values(input)
        .onConflictDoUpdate({
          target: workCalendarException.onDate,
          set: { isWorking: input.isWorking, reason: input.reason, updatedAt: sql`now()` },
        })
        .returning({ onDate: workCalendarException.onDate }),
    );
    return row ? ok(row) : err(FORBIDDEN);
  },
});

export const deleteCalendarException = defineService({
  name: 'settings.calendar.delete',
  input: z.object({ onDate: localDateString }),
  handler: async (ctx, { onDate }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .delete(workCalendarException)
        .where(eq(workCalendarException.onDate, onDate))
        .returning({ onDate: workCalendarException.onDate }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'settings.exceptionNotFound'));
  },
});

export const listSequences = defineService({
  name: 'settings.sequences.list',
  input: z.object({}),
  handler: async (ctx) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          sequence: numberSequence,
          contracts: sql<
            string[]
          >`coalesce(array_agg(${contract.number}) filter (where ${contract.id} is not null), '{}')`,
        })
        .from(numberSequence)
        .leftJoin(contract, eq(contract.numberSequenceKey, numberSequence.key))
        .groupBy(numberSequence.key)
        .orderBy(asc(numberSequence.key)),
    );
    const year = Number(ctx.today.slice(0, 4));
    return ok(
      rows.map(({ sequence: s, contracts }) => {
        const resets = s.yearScoped && s.currentYear !== null && s.currentYear < year;
        return {
          ...s,
          contracts,
          nextNumber: formatSequenceNumber(
            s.template,
            resets ? 1 : s.nextValue,
            year,
            contracts.length === 1 ? contracts[0] : '',
          ),
        };
      }),
    );
  },
});

const sequenceKey = z
  .string()
  .trim()
  .regex(/^[\w:.-]{1,64}$/, 'settings.sequenceKey');

/**
 * Create or adjust a sequence (5.6). The counter may only move forward — the DB rejects a
 * decrease (TL020), so an issued number can never be handed out twice.
 */
export const saveSequence = defineService({
  name: 'settings.sequences.save',
  input: z.object({
    key: sequenceKey,
    template: requiredText('settings.templateRequired').refine(
      (t) => t.includes('{seq}'),
      'settings.templateSeq',
    ),
    nextValue: z.coerce
      .number({ error: 'field.numberRequired' })
      .int('field.integer')
      .min(1, 'field.atLeastOne'),
    yearScoped: checkbox,
  }),
  handler: async (ctx, input) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .insert(numberSequence)
        .values({
          ...input,
          currentYear: input.yearScoped ? Number(ctx.today.slice(0, 4)) : null,
        })
        .onConflictDoUpdate({
          target: numberSequence.key,
          set: {
            template: input.template,
            nextValue: input.nextValue,
            yearScoped: input.yearScoped,
            updatedAt: sql`now()`,
          },
        })
        .returning({ key: numberSequence.key }),
    );
    return row ? ok(row) : err(FORBIDDEN);
  },
});

/** Settings → background jobs (6.10): the latest queue entries with their errors. */
export const listJobs = defineService({
  name: 'settings.jobs.list',
  input: z.object({ limit: z.number().int().min(1).max(200).default(30) }),
  handler: async (ctx, { limit }) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx.select().from(job).orderBy(desc(job.createdAt)).limit(limit),
      ),
    ),
});
