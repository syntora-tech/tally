import { createDb } from '@tally/db';
import { numberSequence } from '@tally/db/schema';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const { db, sql: client } = createDb(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  { max: 20 },
);
const KEY = `test:parallel:${Date.now()}`;

beforeAll(async () => {
  await db.insert(numberSequence).values({
    key: KEY,
    template: '{seq}/{yy}',
    nextValue: 1,
    yearScoped: true,
    currentYear: 2032,
  });
});

afterAll(async () => {
  await db.delete(numberSequence).where(eq(numberSequence.key, KEY));
  await client.end();
});

describe('issue_number under concurrency (spec 9.3, I2)', () => {
  it('20 parallel issues get 20 distinct consecutive numbers', async () => {
    const issue = () =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.actor', 'system:test', true)`);
        const [row] = await tx.execute<{ n: string }>(
          sql`select public.issue_number(${KEY}, '2032-03-01') as n`,
        );
        return row?.n ?? '';
      });
    const numbers = await Promise.all(Array.from({ length: 20 }, issue));
    const seqs = numbers.map((n) => Number(n.split('/')[0])).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(new Set(numbers).size).toBe(20);
    const [seq] = await db.select().from(numberSequence).where(eq(numberSequence.key, KEY));
    expect(seq?.nextValue).toBe(21);
  });
});
