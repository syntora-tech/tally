import 'server-only';
import { createDb, type Db } from '@tally/db';
import { getServerEnv } from '../env';

const globalForDb = globalThis as unknown as { tallyDb?: Db };

/**
 * Raw connection as the `postgres` role — bypasses RLS. Use it only through `withUser()` /
 * `withSystem()`; never query it directly from request handlers.
 */
export function getDb(): Db {
  globalForDb.tallyDb ??= createDb(getServerEnv().DATABASE_URL).db;
  return globalForDb.tallyDb;
}
