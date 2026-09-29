import { appUser, auditLog } from '@tally/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';

const IGNORED_FIELDS = new Set(['id', 'created_at', 'updated_at', 'created_by']);

export type AuditEntry = {
  id: string;
  at: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actorEmail: string | null;
  actorLabel: string | null;
  via: string | null;
  changes: { field: string; from: unknown; to: unknown }[];
};

/** Field-level diff of an audit row; for inserts every non-empty field counts as a change. */
export function auditChanges(
  oldRow: Record<string, unknown> | null,
  newRow: Record<string, unknown> | null,
): AuditEntry['changes'] {
  const keys = new Set([...Object.keys(oldRow ?? {}), ...Object.keys(newRow ?? {})]);
  const changes: AuditEntry['changes'] = [];
  for (const field of keys) {
    if (IGNORED_FIELDS.has(field)) continue;
    const from = oldRow?.[field] ?? null;
    const to = newRow?.[field] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

/** History card for any record (spec 6: every card shows audit_log changes). RLS: owner/finance. */
export const rowHistory = defineService({
  name: 'audit.rowHistory',
  input: z.object({ tableName: z.string().regex(/^[a-z_]+$/), rowId: z.uuid() }),
  handler: async (ctx, { tableName, rowId }) => {
    const rows = await inActorScope(ctx, (tx) =>
      tx
        .select({
          id: auditLog.id,
          at: auditLog.at,
          action: auditLog.action,
          old: auditLog.old,
          new: auditLog.new,
          actorEmail: appUser.email,
          actorLabel: auditLog.actorLabel,
          via: auditLog.via,
        })
        .from(auditLog)
        .leftJoin(appUser, eq(appUser.id, auditLog.actor))
        .where(and(eq(auditLog.tableName, tableName), eq(auditLog.rowId, rowId)))
        .orderBy(desc(auditLog.id))
        .limit(100),
    );
    return ok(
      rows.map((r): AuditEntry => ({
        id: r.id.toString(),
        at: r.at.toISOString(),
        action: r.action as AuditEntry['action'],
        actorEmail: r.actorEmail,
        actorLabel: r.actorLabel,
        via: r.via,
        changes: auditChanges(
          r.old as Record<string, unknown> | null,
          r.new as Record<string, unknown> | null,
        ),
      })),
    );
  },
});
