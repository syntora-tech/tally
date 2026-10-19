import type { DbTransaction } from '@tally/db';
import { userSecret } from '@tally/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { AiFailure, ClaudeClient } from '../../ai/claude';
import { decryptSecret, encryptSecret } from '../../secrets/cipher';
import { inActorScope, type ServiceContext } from '../context';
import { defineService } from '../define-service';
import { serviceError, type ServiceError } from '../errors';

const KIND = 'anthropic_api_key';

const userIdOf = (ctx: ServiceContext) => (ctx.actor.kind === 'user' ? ctx.actor.userId : null);

/** Whether AI features can be offered to this user: the server can encrypt and a key is stored. */
export const aiKeyStatus = defineService({
  name: 'ai.key.status',
  input: z.object({}),
  handler: async (ctx) => {
    if (!ctx.config.encryptionKey || !userIdOf(ctx)) {
      return ok({ available: false, hint: null, verifiedAt: null });
    }
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .select({ hint: userSecret.hint, verifiedAt: userSecret.verifiedAt })
        .from(userSecret)
        .where(eq(userSecret.kind, KIND)),
    );
    return ok({ available: true, hint: row?.hint ?? null, verifiedAt: row?.verifiedAt ?? null });
  },
});

/** True when the AI buttons may be shown; every AI service checks the key again on its own. */
export async function aiEnabled(ctx: ServiceContext): Promise<boolean> {
  const status = await aiKeyStatus.run(ctx, {});
  return status.isOk() && Boolean(status.value.hint);
}

const apiKey = z
  .string()
  .trim()
  .refine((v) => !v.startsWith('sk-ant-oat'), 'ai.subscriptionToken')
  .refine((v) => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v), 'ai.keyFormat');

export function aiFailureError(failure: AiFailure): ServiceError {
  switch (failure) {
    case 'invalid_key':
      return serviceError('validation_error', 'ai.keyRejected');
    case 'rate_limited':
      return serviceError('conflict', 'ai.rateLimited');
    case 'refused':
      return serviceError('conflict', 'ai.refused');
    case 'bad_output':
      return serviceError('internal_error', 'ai.badOutput');
    case 'unavailable':
      return serviceError('internal_error', 'ai.unavailable');
  }
}

function claudeFor(ctx: ServiceContext, key: string): Result<ClaudeClient, ServiceError> {
  const factory = ctx.config.integrations?.claude;
  return factory ? ok(factory(key)) : err(serviceError('internal_error', 'ai.unavailable'));
}

/**
 * Stores the user's own Anthropic API key (A-120) after one free call proves it works. Only the
 * ciphertext and the last four characters are kept; the key never goes back to the browser.
 */
export const saveAiKey = defineService({
  name: 'ai.key.save',
  input: z.object({ apiKey }),
  handler: async (ctx, input) => {
    const userId = userIdOf(ctx);
    const secretKey = ctx.config.encryptionKey;
    if (!userId) return err(serviceError('unauthenticated', 'general.forbidden'));
    if (!secretKey) return err(serviceError('conflict', 'ai.notConfigured'));
    const claude = claudeFor(ctx, input.apiKey);
    if (claude.isErr()) return err(claude.error);
    const verified = await claude.value.verify();
    if (verified.isErr()) {
      const error = aiFailureError(verified.error);
      return err(
        verified.error === 'invalid_key'
          ? serviceError('validation_error', error.message, { apiKey: [error.message] })
          : error,
      );
    }
    const values = {
      userId,
      kind: KIND,
      ciphertext: encryptSecret(secretKey, userId, input.apiKey),
      hint: input.apiKey.slice(-4),
      verifiedAt: new Date(),
    };
    await inActorScope(ctx, (tx) =>
      tx
        .insert(userSecret)
        .values(values)
        .onConflictDoUpdate({
          target: [userSecret.userId, userSecret.kind],
          set: { ciphertext: values.ciphertext, hint: values.hint, verifiedAt: sql`now()` },
        }),
    );
    return ok({ hint: values.hint });
  },
});

export const deleteAiKey = defineService({
  name: 'ai.key.delete',
  input: z.object({}),
  handler: async (ctx) => {
    await inActorScope(ctx, (tx) => tx.delete(userSecret).where(eq(userSecret.kind, KIND)));
    return ok({ deleted: true });
  },
});

/** The decrypted key and a client for it, read inside the caller's RLS scope (own row only). */
export async function claudeForUser(
  ctx: ServiceContext,
  tx: DbTransaction,
): Promise<Result<ClaudeClient, ServiceError>> {
  const userId = userIdOf(ctx);
  const secretKey = ctx.config.encryptionKey;
  if (!userId || !secretKey) return err(serviceError('conflict', 'ai.keyMissing'));
  const [row] = await tx
    .select({ ciphertext: userSecret.ciphertext })
    .from(userSecret)
    .where(and(eq(userSecret.kind, KIND), eq(userSecret.userId, userId)));
  if (!row) return err(serviceError('conflict', 'ai.keyMissing'));
  const key = decryptSecret(secretKey, userId, row.ciphertext);
  if (key.isErr()) return err(serviceError('conflict', 'ai.keyUnreadable'));
  return claudeFor(ctx, key.value);
}
