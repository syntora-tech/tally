import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { rolePolicies } from './_common';

const audit = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid().default(sql`auth.uid()`),
};

/** Owner-maintained working-day overrides (spec 5.5): holidays off, weekends on. */
export const workCalendarException = pgTable(
  'work_calendar_exception',
  {
    onDate: date({ mode: 'string' }).primaryKey(),
    isWorking: boolean().notNull(),
    reason: text().notNull(),
    ...audit,
  },
  (t) => [
    check('work_calendar_exception_reason_check', sql`length(trim(${t.reason})) > 0`),
    ...rolePolicies('work_calendar_exception', { read: 'all', write: 'owner' }),
  ],
);

/**
 * Document number sequences (spec 5.6). Numbers are issued only by `issue_number()` (I2);
 * `next_value` never decreases except for the yearly reset of year-scoped sequences.
 */
export const numberSequence = pgTable(
  'number_sequence',
  {
    key: text().primaryKey(),
    template: text().notNull(),
    nextValue: integer().notNull().default(1),
    yearScoped: boolean().notNull().default(false),
    currentYear: integer(),
    ...audit,
  },
  (t) => [
    check('number_sequence_next_value_check', sql`${t.nextValue} >= 1`),
    check('number_sequence_template_check', sql`${t.template} like '%{seq}%'`),
    ...rolePolicies('number_sequence', { read: 'finance', write: 'owner' }),
  ],
);

export type WorkCalendarException = typeof workCalendarException.$inferSelect;
export type NumberSequence = typeof numberSequence.$inferSelect;
