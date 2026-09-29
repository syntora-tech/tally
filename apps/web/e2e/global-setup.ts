import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { clearMailbox } from './mailpit';

/** Fresh state per run: test auth users (cascading to app_user) and the mailbox are wiped. */
export default async function globalSetup() {
  const { db, sql: client } = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(sql`delete from auth.users where email like '%@tally.test'`);
  } finally {
    await client.end();
  }
  await clearMailbox();
}
