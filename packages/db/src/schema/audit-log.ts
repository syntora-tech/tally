import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { isOwnerOrFinance } from './_common';

/** Written only by the `audit_row_change()` trigger (I8); read-only for owner/finance. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial({ mode: 'bigint' }).primaryKey(),
    tableName: text().notNull(),
    rowId: uuid(),
    action: text().notNull(),
    old: jsonb(),
    new: jsonb(),
    actor: uuid(),
    actorLabel: text(),
    via: text(),
    clientId: text(),
    /** Why a guarded change was made, e.g. reopening a closed period (spec I6). */
    reason: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('audit_log_action_check', sql`${t.action} in ('INSERT', 'UPDATE', 'DELETE')`),
    index('audit_log_row_idx').on(t.tableName, t.rowId, t.at),
    pgPolicy('audit_log_select_owner_finance', {
      for: 'select',
      to: authenticatedRole,
      using: isOwnerOrFinance,
    }),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
