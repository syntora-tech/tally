import type { DbTransaction } from '@tally/db';
import { sql } from 'drizzle-orm';
import type { Result } from 'neverthrow';
import { inActorScope, type ServiceContext } from './context';

class Rollback<T, E> extends Error {
  constructor(readonly result: Result<T, E>) {
    super('rollback');
  }
}

/**
 * One all-or-nothing DB transaction for batch writes: an `Err` rolls everything back, and
 * `dryRun` runs the whole batch — deferred invariants (I5) included — then rolls back, so the
 * preview fails exactly where the real write would (spec 13.4 rule 3).
 */
export async function inActorScopeAtomic<T, E>(
  ctx: ServiceContext,
  options: { dryRun: boolean },
  fn: (tx: DbTransaction) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
  try {
    return await inActorScope(ctx, async (tx) => {
      const result = await fn(tx);
      if (result.isErr()) throw new Rollback(result);
      if (options.dryRun) {
        await tx.execute(sql`set constraints all immediate`);
        throw new Rollback(result);
      }
      return result;
    });
  } catch (error) {
    if (error instanceof Rollback) return error.result as Result<T, E>;
    throw error;
  }
}
