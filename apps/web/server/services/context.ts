import type { Db, DbTransaction } from '@tally/db';
import type { AppRole } from '@tally/db/schema';
import type { LocalDate } from '@tally/domain';
import { withSystem, withUser, type JwtClaims, type SystemActor } from '../db/with-user';

export type Actor =
  | {
      kind: 'user';
      userId: string;
      email: string;
      /** Null until the user has an active app_user row. */
      role: AppRole | null;
      claims: JwtClaims;
      via: 'ui' | 'mcp';
      clientId?: string;
    }
  | { kind: 'system'; label: SystemActor }
  | { kind: 'anonymous' };

export type ServiceContext = {
  actor: Actor;
  today: LocalDate;
  db: Db;
};

/** Opens the DB scope matching the actor: RLS-bound for users, privileged for system jobs. */
export function inActorScope<T>(
  ctx: ServiceContext,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const { actor } = ctx;
  switch (actor.kind) {
    case 'user':
      return withUser(
        ctx.db,
        {
          claims: actor.claims,
          via: actor.via,
          ...(actor.clientId ? { clientId: actor.clientId } : {}),
        },
        fn,
      );
    case 'system':
      return withSystem(ctx.db, actor.label, fn);
    case 'anonymous':
      return Promise.reject(new Error('Anonymous actors have no database scope'));
  }
}
