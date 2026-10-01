import { appUser } from '@tally/db/schema';
import { eq, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { withSystem } from '../../db/with-user';
import { defineService } from '../define-service';
import { serviceError } from '../errors';
import { decideSignIn, normalizeEmail } from './sign-in-policy';

const emailInput = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'auth.email' }));

/**
 * Pre-flight before sending a magic link, so no email goes to addresses without access.
 * Runs before authentication, hence the system scope for the lookup.
 */
export const checkSignInAllowed = defineService({
  name: 'auth.checkSignInAllowed',
  input: z.object({ email: emailInput }),
  handler: async (ctx, { email }) => {
    const existing = await withSystem(ctx.db, 'system:auth', async (tx) => {
      const [row] = await tx
        .select({ role: appUser.role, isActive: appUser.isActive })
        .from(appUser)
        .where(sql`lower(${appUser.email}) = ${email}`);
      return row ?? null;
    });
    const decision = decideSignIn(email, ctx.config.allowedEmails, existing);
    return ok({ email, allowed: decision.kind !== 'deny' });
  },
});

/**
 * Runs after Supabase has authenticated the user (magic link or Google): admits active app_users
 * and creates the owner row for whitelisted first-time emails.
 */
export const completeSignIn = defineService({
  name: 'auth.completeSignIn',
  input: z.object({ userId: z.uuid(), email: emailInput }),
  handler: async (ctx, { userId, email }) => {
    return withSystem(ctx.db, 'system:auth', async (tx) => {
      const [existing] = await tx
        .select({ role: appUser.role, isActive: appUser.isActive })
        .from(appUser)
        .where(eq(appUser.id, userId));
      const decision = decideSignIn(email, ctx.config.allowedEmails, existing ?? null);

      switch (decision.kind) {
        case 'allow':
          return ok({ role: decision.role });
        case 'bootstrap_owner':
          await tx
            .insert(appUser)
            .values({ id: userId, email: normalizeEmail(email), role: 'owner' })
            .onConflictDoNothing();
          return ok({ role: 'owner' as const });
        case 'deny':
          return err(serviceError('forbidden', 'auth.noAccess'));
      }
    });
  },
});
