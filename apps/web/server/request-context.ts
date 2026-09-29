import 'server-only';
import { appUser, type AppRole } from '@tally/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from './db/client';
import { withUser, type JwtClaims } from './db/with-user';
import { getServerEnv } from './env';
import type { Actor, ServiceContext } from './services/context';
import { createSupabaseServerClient } from './supabase/server-client';
import { getToday } from './today';

export type UserActor = Extract<Actor, { kind: 'user' }>;

function baseContext(actor: Actor): ServiceContext {
  return {
    actor,
    today: getToday(),
    db: getDb(),
    config: { allowedEmails: getServerEnv().ALLOWED_EMAILS },
  };
}

export function anonymousContext(): ServiceContext {
  return baseContext({ kind: 'anonymous' });
}

/** Verified session user with the role from app_user (null when absent or inactive). */
export const getSessionActor = cache(async (): Promise<UserActor | null> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return null;

  const claims = data.claims as JwtClaims;
  const [row] = await withUser(getDb(), { claims, via: 'ui' }, (tx) =>
    tx
      .select({ role: appUser.role, isActive: appUser.isActive })
      .from(appUser)
      .where(eq(appUser.id, claims.sub)),
  );

  return {
    kind: 'user',
    userId: claims.sub,
    email: claims.email ?? '',
    role: row?.isActive ? row.role : null,
    claims,
    via: 'ui',
  };
});

/** For (app) pages and actions: a signed-in user with an active app_user, or redirect. */
export async function requireUserContext(): Promise<ServiceContext & { actor: UserActor }> {
  const actor = await getSessionActor();
  if (!actor) redirect('/login');
  if (!actor.role) redirect('/login?error=forbidden');
  return { ...baseContext(actor), actor };
}

/** Page-level gate for role-restricted modules; RLS still enforces data access. */
export async function requireRole(
  roles: readonly AppRole[],
): Promise<ServiceContext & { actor: UserActor & { role: AppRole } }> {
  const ctx = await requireUserContext();
  const { role } = ctx.actor;
  if (!role || !roles.includes(role)) redirect('/dashboard');
  return { ...ctx, actor: { ...ctx.actor, role } };
}
