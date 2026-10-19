import type { Db, DbTransaction } from '@tally/db';
import type { AppRole } from '@tally/db/schema';
import type { LocalDate } from '@tally/domain';
import type { ClaudeClient } from '../ai/claude';
import type { ChainReader } from '../chain';
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

/** Outside services the import talks to; tests pass fakes, the app the real clients. */
export type Integrations = {
  claude: (apiKey: string) => ClaudeClient;
  chain: ChainReader;
};

export type ServiceConfig = {
  allowedEmails: readonly string[];
  /** APP_ENCRYPTION_KEY; without it personal AI keys cannot be stored and AI stays off (A-120). */
  encryptionKey?: string;
  integrations?: Integrations;
};

export type ServiceContext = {
  actor: Actor;
  today: LocalDate;
  db: Db;
  config: ServiceConfig;
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
