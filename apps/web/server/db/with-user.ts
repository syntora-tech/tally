import 'server-only';
import type { Db, DbTransaction } from '@tally/db';
import { sql } from 'drizzle-orm';

export type JwtClaims = {
  sub: string;
  role: string;
  email?: string;
  [claim: string]: unknown;
};

export type UserScope = {
  claims: JwtClaims;
  via: 'ui' | 'mcp';
  clientId?: string;
};

/**
 * Runs `fn` in a transaction as the `authenticated` role with the user's JWT claims, so RLS and
 * `auth.uid()` behave exactly as for a Supabase client (spec 4.4, 13.5).
 */
export async function withUser<T>(
  db: Db,
  scope: UserScope,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('request.jwt.claims', ${JSON.stringify(scope.claims)}, true),
        set_config('app.via', ${scope.via}, true),
        set_config('app.client_id', ${scope.clientId ?? ''}, true)
    `);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

export type SystemActor = `system:${string}`;

/** Privileged transaction for cron/job handlers and import; audited as `actor_label`. */
export async function withSystem<T>(
  db: Db,
  actor: SystemActor,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select set_config('app.actor', ${actor}, true), set_config('app.via', 'system', true)
    `);
    return fn(tx);
  });
}
