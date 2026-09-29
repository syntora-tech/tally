import { randomUUID } from 'node:crypto';
import { createDb, type Db } from '@tally/db';
import { appUser, type AppRole } from '@tally/db/schema';
import { parseLocalDate, type LocalDate } from '@tally/domain';
import { sql } from 'drizzle-orm';
import type { ServiceContext } from '../server/services/context';

/** Integration-test harness: a raw connection plus users with roles and their service contexts. */
export function intHarness(today = '2026-09-29') {
  const { db, sql: client } = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 3 },
  );
  const userIds: string[] = [];
  const todayDate = parseLocalDate(today)._unsafeUnwrap();

  async function user(role: AppRole) {
    const id = randomUUID();
    const email = `${role}-${id}@int.test`;
    await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
    await db.insert(appUser).values({ id, email, role });
    userIds.push(id);
    return { id, email, role };
  }

  function ctxFor(
    u: { id: string; email: string; role: AppRole },
    on: LocalDate = todayDate,
  ): ServiceContext {
    return {
      actor: {
        kind: 'user',
        userId: u.id,
        email: u.email,
        role: u.role,
        claims: { sub: u.id, role: 'authenticated', email: u.email },
        via: 'ui',
      },
      today: on,
      db,
      config: { allowedEmails: [] },
    };
  }

  function systemCtx(): ServiceContext {
    return {
      actor: { kind: 'system', label: 'system:test' },
      today: todayDate,
      db,
      config: { allowedEmails: [] },
    };
  }

  async function cleanup(extra?: (db: Db) => Promise<unknown>) {
    if (extra) await extra(db);
    for (const id of userIds) await db.execute(sql`delete from auth.users where id = ${id}`);
    await client.end();
  }

  return { db, user, ctxFor, systemCtx, cleanup, today: todayDate };
}
