import { mcpCallLog, mcpClientPolicy, MCP_PROFILES } from '@tally/db/schema';
import { desc, eq } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { requiredText } from '../fields';
import { generateToken } from './token';

const FORBIDDEN = serviceError('forbidden', 'mcp.ownerOnly');

/** MCP clients of the owner, without token hashes (13.6 «Підключені агенти»). */
export const listMcpClients = defineService({
  name: 'mcp.clients.list',
  input: z.object({}),
  handler: async (ctx) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx
          .select({
            clientId: mcpClientPolicy.clientId,
            clientName: mcpClientPolicy.clientName,
            profile: mcpClientPolicy.profile,
            tokenHint: mcpClientPolicy.tokenHint,
            isActive: mcpClientPolicy.isActive,
            lastUsedAt: mcpClientPolicy.lastUsedAt,
            createdAt: mcpClientPolicy.createdAt,
          })
          .from(mcpClientPolicy)
          .orderBy(desc(mcpClientPolicy.isActive), desc(mcpClientPolicy.createdAt)),
      ),
    ),
});

/**
 * Issues a personal access token bound to the owner (Q18 fallback until OAuth, A-053). The token
 * is returned once; the agent acts with the owner's role intersected with the profile.
 */
export const createMcpClient = defineService({
  name: 'mcp.clients.create',
  input: z.object({
    clientName: requiredText('mcp.clientName'),
    profile: z.enum(MCP_PROFILES).default('read_only'),
  }),
  handler: async (ctx, input) => {
    if (ctx.actor.kind !== 'user') return err(FORBIDDEN);
    const { token, hash, hint, clientId } = generateToken();
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .insert(mcpClientPolicy)
        .values({
          ...input,
          clientId,
          userId: ctx.actor.kind === 'user' ? ctx.actor.userId : '',
          tokenHash: hash,
          tokenHint: hint,
        })
        .returning({ clientId: mcpClientPolicy.clientId }),
    );
    return row ? ok({ clientId: row.clientId, token }) : err(FORBIDDEN);
  },
});

/** Takes effect on the next call, even with a valid token (13.6). */
export const revokeMcpClient = defineService({
  name: 'mcp.clients.revoke',
  input: z.object({ clientId: z.string().min(1) }),
  handler: async (ctx, { clientId }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(mcpClientPolicy)
        .set({ isActive: false })
        .where(eq(mcpClientPolicy.clientId, clientId))
        .returning({ clientId: mcpClientPolicy.clientId }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'mcp.notFound'));
  },
});

export const listMcpCalls = defineService({
  name: 'mcp.calls.list',
  input: z.object({ limit: z.number().int().min(1).max(500).default(50) }),
  handler: async (ctx, { limit }) =>
    ok(
      await inActorScope(ctx, (tx) =>
        tx.select().from(mcpCallLog).orderBy(desc(mcpCallLog.at)).limit(limit),
      ),
    ),
});
