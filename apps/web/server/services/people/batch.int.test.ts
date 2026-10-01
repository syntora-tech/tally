import { randomUUID } from 'node:crypto';
import { person } from '@tally/db/schema';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { upsertPeople } from './batch';

const h = intHarness();
const tag = randomUUID().slice(0, 8);
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
});

afterAll(() => h.cleanup((db) => db.delete(person).where(like(person.fullName, `P ${tag}%`))));

it('creates, then patches only the sent fields matched by name (13.3)', async () => {
  const ctx = h.ctxFor(finance);
  const name = `P ${tag} Ivan`;
  const created = await upsertPeople.run(ctx, {
    people: [
      {
        fullName: name,
        stack: ['React', 'Node'],
        marketRateUsd: '30',
        location: 'Kyiv',
        status: 'bench',
      },
    ],
  });
  expect(created._unsafeUnwrap().people[0]?.status).toBe('created');

  const patched = await upsertPeople.run(ctx, {
    people: [{ fullName: name.toUpperCase(), marketRateUsd: '35', availabilityFrom: '2026-11-01' }],
  });
  expect(patched._unsafeUnwrap().people[0]?.status).toBe('updated');
  const [row] = await h.db
    .select()
    .from(person)
    .where(like(person.fullName, `P ${tag}%`));
  expect(row).toMatchObject({
    stack: ['React', 'Node'],
    location: 'Kyiv',
    status: 'bench',
    marketRateUsd: '35.00000000',
    availabilityFrom: '2026-11-01',
  });
});

it('reports item errors and writes nothing; a viewer is denied', async () => {
  const bad = await upsertPeople.run(h.ctxFor(finance), {
    people: [{ fullName: `P ${tag} Ok` }, { position: 'Dev' }],
  });
  expect(Object.keys(bad._unsafeUnwrapErr().fieldErrors ?? {})).toEqual(['people.1']);
  expect(
    await h.db
      .select()
      .from(person)
      .where(like(person.fullName, `P ${tag} Ok`)),
  ).toHaveLength(0);
  const denied = await upsertPeople.run(h.ctxFor(viewer), { people: [{ fullName: `P ${tag} V` }] });
  expect(denied.isErr()).toBe(true);
});
