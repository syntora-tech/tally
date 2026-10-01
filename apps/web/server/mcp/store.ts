import 'server-only';
import type { Db } from '@tally/db';
import {
  appUser,
  mcpCallLog,
  mcpClientPolicy,
  mcpIdempotency,
  type AppRole,
  type McpProfile,
} from '@tally/db/schema';
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { withSystem } from '../db/with-user';
import { hashToken } from '../services/mcp/token';

// MCP bookkeeping runs before the caller is known (token lookup) or outside its RLS scope
// (idempotency, call log), so it uses the system connection, audited as `system:mcp`.

export type McpClient = {
  clientId: string;
  clientName: string;
  profile: McpProfile;
  allowedTools: string[] | null;
  user: { id: string; email: string; role: AppRole };
};

/** Active client with an active owner user, or null (revoked clients get 403 immediately). */
export async function findClientByToken(db: Db, token: string): Promise<McpClient | null> {
  return withSystem(db, 'system:mcp', async (tx) => {
    const [row] = await tx
      .select({ policy: mcpClientPolicy, user: appUser })
      .from(mcpClientPolicy)
      .innerJoin(appUser, eq(appUser.id, mcpClientPolicy.userId))
      .where(eq(mcpClientPolicy.tokenHash, hashToken(token)));
    if (!row) return null;
    if (!row.policy.isActive || !row.user.isActive) return null;
    await tx
      .update(mcpClientPolicy)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(mcpClientPolicy.id, row.policy.id));
    return {
      clientId: row.policy.clientId,
      clientName: row.policy.clientName,
      profile: row.policy.profile as McpProfile,
      allowedTools: row.policy.allowedTools,
      user: { id: row.user.id, email: row.user.email, role: row.user.role },
    };
  });
}

/** Tells apart an unknown token (401) from a revoked one (403). */
export async function tokenExists(db: Db, token: string): Promise<boolean> {
  const rows = await withSystem(db, 'system:mcp', (tx) =>
    tx
      .select({ id: mcpClientPolicy.id })
      .from(mcpClientPolicy)
      .where(eq(mcpClientPolicy.tokenHash, hashToken(token))),
  );
  return rows.length > 0;
}

export async function recentCalls(db: Db, clientId: string, tools: readonly string[]) {
  const [row] = await withSystem(db, 'system:mcp', (tx) =>
    tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mcpCallLog)
      .where(
        and(
          eq(mcpCallLog.clientId, clientId),
          inArray(mcpCallLog.tool, [...tools]),
          gte(mcpCallLog.at, sql`now() - interval '1 minute'`),
        ),
      ),
  );
  return row?.count ?? 0;
}

export async function logCall(
  db: Db,
  entry: {
    clientId: string;
    userId: string;
    tool: string;
    argsHash: string;
    outcome: string;
    durationMs: number;
  },
) {
  await withSystem(db, 'system:mcp', (tx) => tx.insert(mcpCallLog).values(entry));
}

export async function findIdempotent(db: Db, clientId: string, key: string) {
  const [row] = await withSystem(db, 'system:mcp', (tx) =>
    tx
      .select()
      .from(mcpIdempotency)
      .where(
        and(
          eq(mcpIdempotency.clientId, clientId),
          eq(mcpIdempotency.key, key),
          gte(mcpIdempotency.createdAt, sql`now() - interval '7 days'`),
        ),
      ),
  );
  return row ?? null;
}

export async function saveIdempotent(
  db: Db,
  entry: { clientId: string; key: string; tool: string; response: unknown },
) {
  await withSystem(db, 'system:mcp', async (tx) => {
    await tx
      .delete(mcpIdempotency)
      .where(lt(mcpIdempotency.createdAt, sql`now() - interval '7 days'`));
    await tx
      .insert(mcpIdempotency)
      .values(entry)
      .onConflictDoUpdate({
        target: [mcpIdempotency.clientId, mcpIdempotency.key],
        set: { tool: entry.tool, response: entry.response, createdAt: sql`now()` },
      });
  });
}
