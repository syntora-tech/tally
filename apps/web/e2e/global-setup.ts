import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_VIEWER_EMAIL, localEnv } from './helpers';
import { clearMailbox } from './mailpit';

/**
 * Fresh state per run: test auth users (cascading to app_user) and the mailbox are wiped, then a
 * viewer is created through the Auth admin API so role-based scenarios can sign in.
 */
export default async function globalSetup() {
  const env = { ...localEnv(), ...process.env };
  const { db, sql: client } = createDb(
    env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(sql`delete from auth.users where email like '%@tally.test'`);

    const url = env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for e2e (run pnpm env:local)');
    const res = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: E2E_VIEWER_EMAIL, email_confirm: true }),
    });
    if (!res.ok) throw new Error(`Cannot create e2e viewer: ${res.status} ${await res.text()}`);
    const { id } = (await res.json()) as { id: string };
    await db.execute(
      sql`insert into public.app_user (id, email, role) values (${id}, ${E2E_VIEWER_EMAIL}, 'viewer')`,
    );
  } finally {
    await client.end();
  }
  await clearMailbox();
}
