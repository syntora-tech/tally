import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type CreateDbOptions = {
  /** Max pool size; keep small for serverless. */
  max?: number;
};

/**
 * Drizzle over postgres.js. `prepare: false` is required by the Supabase pooler in transaction
 * mode (spec 2.3). Numeric columns come back as strings — never convert them to numbers.
 */
export function createDb(url: string, options: CreateDbOptions = {}) {
  const sql = postgres(url, { prepare: false, max: options.max ?? 5 });
  const db = drizzle(sql, { schema, casing: 'snake_case' });
  return { db, sql };
}

export type Db = ReturnType<typeof createDb>['db'];
export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];
