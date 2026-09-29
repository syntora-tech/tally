import { randomUUID } from 'node:crypto';
import { createDb } from '@tally/db';
import { appUser } from '@tally/db/schema';
import { parseLocalDate } from '@tally/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServiceContext } from '../context';
import { checkSignInAllowed, completeSignIn } from '.';

const { db, sql: client } = createDb(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  { max: 2 },
);

const owner = { id: randomUUID(), email: `owner-${randomUUID()}@int.test` };
const stranger = { id: randomUUID(), email: `stranger-${randomUUID()}@int.test` };
const retired = { id: randomUUID(), email: `retired-${randomUUID()}@int.test` };
const users = [owner, stranger, retired];

const ctx: ServiceContext = {
  actor: { kind: 'anonymous' },
  today: parseLocalDate('2026-09-29')._unsafeUnwrap(),
  db,
  config: { allowedEmails: [owner.email, retired.email] },
};

beforeAll(async () => {
  for (const u of users) {
    await db.execute(sql`insert into auth.users (id, email) values (${u.id}, ${u.email})`);
  }
  await db.insert(appUser).values({ ...retired, role: 'owner', isActive: false });
});

afterAll(async () => {
  for (const u of users) await db.execute(sql`delete from auth.users where id = ${u.id}`);
  await client.end();
});

describe('completeSignIn', () => {
  it('creates an owner app_user for a whitelisted first sign-in', async () => {
    const result = await completeSignIn.run(ctx, { userId: owner.id, email: owner.email });
    expect(result._unsafeUnwrap()).toEqual({ role: 'owner' });
    const [row] = await db.select().from(appUser).where(eq(appUser.id, owner.id));
    expect(row).toMatchObject({ role: 'owner', isActive: true, email: owner.email });
  });

  it('is idempotent for an existing active user', async () => {
    const result = await completeSignIn.run(ctx, { userId: owner.id, email: owner.email });
    expect(result._unsafeUnwrap()).toEqual({ role: 'owner' });
  });

  it('rejects an authenticated user outside the whitelist and creates nothing', async () => {
    const result = await completeSignIn.run(ctx, { userId: stranger.id, email: stranger.email });
    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
    expect(await db.select().from(appUser).where(eq(appUser.id, stranger.id))).toHaveLength(0);
  });

  it('rejects a deactivated user even if whitelisted', async () => {
    const result = await completeSignIn.run(ctx, { userId: retired.id, email: retired.email });
    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
  });
});

describe('checkSignInAllowed', () => {
  it('matches app_user emails case-insensitively', async () => {
    const result = await checkSignInAllowed.run(ctx, { email: owner.email.toUpperCase() });
    expect(result._unsafeUnwrap()).toEqual({ email: owner.email, allowed: true });
  });

  it('denies strangers and deactivated users', async () => {
    expect(
      (await checkSignInAllowed.run(ctx, { email: stranger.email }))._unsafeUnwrap().allowed,
    ).toBe(false);
    expect(
      (await checkSignInAllowed.run(ctx, { email: retired.email }))._unsafeUnwrap().allowed,
    ).toBe(false);
  });
});
