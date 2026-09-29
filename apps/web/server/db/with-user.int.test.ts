import { randomUUID } from 'node:crypto';
import { createDb } from '@tally/db';
import { appUser, auditLog } from '@tally/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withUser, type UserScope } from './with-user';

const { db, sql: client } = createDb(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  { max: 2 },
);

const ownerId = randomUUID();
const viewerId = randomUUID();
const scope = (sub: string): UserScope => ({ claims: { sub, role: 'authenticated' }, via: 'ui' });

beforeAll(async () => {
  await db.execute(sql`
    insert into auth.users (id, email) values
      (${ownerId}, ${`${ownerId}@test.local`}), (${viewerId}, ${`${viewerId}@test.local`})
  `);
  await db.insert(appUser).values([
    { id: ownerId, email: `${ownerId}@test.local`, role: 'owner' },
    { id: viewerId, email: `${viewerId}@test.local`, role: 'viewer' },
  ]);
});

afterAll(async () => {
  await db.execute(sql`delete from auth.users where id in (${ownerId}, ${viewerId})`);
  await client.end();
});

describe('withUser', () => {
  it('runs as the authenticated role with the user id', async () => {
    const row = await withUser(db, scope(viewerId), async (tx) => {
      const [r] = await tx.execute<{ role: string; uid: string }>(
        sql`select current_user as role, auth.uid()::text as uid`,
      );
      return r;
    });
    expect(row).toEqual({ role: 'authenticated', uid: viewerId });
  });

  it('enforces RLS: a viewer sees only their own app_user row', async () => {
    const rows = await withUser(db, scope(viewerId), (tx) =>
      tx.select({ id: appUser.id }).from(appUser),
    );
    expect(rows).toEqual([{ id: viewerId }]);
  });

  it('does not leak role or claims to the next transaction on the pool', async () => {
    await withUser(db, scope(viewerId), (tx) => tx.execute(sql`select 1`));
    const [row] = await db.execute<{ role: string; claims: string | null }>(
      sql`select current_user as role, nullif(current_setting('request.jwt.claims', true), '') as claims`,
    );
    expect(row).toEqual({ role: 'postgres', claims: null });
  });

  it('records the actor and via in audit_log', async () => {
    await withUser(db, scope(ownerId), (tx) =>
      tx.update(appUser).set({ role: 'finance' }).where(eq(appUser.id, viewerId)),
    );
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, 'app_user'), eq(auditLog.rowId, viewerId)))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(entry).toMatchObject({ action: 'UPDATE', actor: ownerId, via: 'ui', actorLabel: null });
  });
});

describe('withSystem', () => {
  it('bypasses RLS and labels the audit entry', async () => {
    const rows = await withSystem(db, 'system:test', async (tx) => {
      await tx.update(appUser).set({ role: 'viewer' }).where(eq(appUser.id, viewerId));
      return tx.select({ id: appUser.id }).from(appUser).where(eq(appUser.id, ownerId));
    });
    expect(rows).toHaveLength(1);
    const [entry] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.rowId, viewerId))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(entry).toMatchObject({ actor: null, actorLabel: 'system:test', via: 'system' });
  });
});
