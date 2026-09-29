import { randomUUID } from 'node:crypto';
import { assignment, client, company, contract, person } from '@tally/db/schema';
import { inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { createPerson, getPerson, searchPeople, updatePerson } from '.';

const h = intHarness('2026-09-29');
const tag = `int-${randomUUID().slice(0, 8)}`;
let owner: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
const ids: Record<string, string> = {};

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('fixture missing');
  return value;
}
const id = (key: string) => must(ids[key]);

beforeAll(async () => {
  owner = await h.user('owner');
  viewer = await h.user('viewer');
  const ctx = h.ctxFor(owner);
  const make = async (key: string, input: Record<string, unknown>) => {
    const res = await createPerson.run(ctx, { fullName: `${tag} ${key}`, ...input });
    ids[key] = res._unsafeUnwrap().id;
  };
  await make('solidity-cheap', {
    stack: 'Solidity, TypeScript',
    marketRateUsd: '45',
    seniority: 'Senior',
  });
  await make('solidity-pricey', { stack: 'solidity', marketRateUsd: '60' });
  await make('solidity-later', {
    stack: 'Solidity',
    marketRateUsd: '40',
    availabilityFrom: '2026-11-01',
  });
  await make('solidity-inactive', { stack: 'Solidity', marketRateUsd: '40', status: 'inactive' });
  await make('rust', { stack: 'Rust', marketRateUsd: '30', allocation: 'part_time' });

  const [co] = await h.db.insert(company).values({ nameEn: 'S', nameUa: 'С' }).returning();
  const [cl] = await h.db
    .insert(client)
    .values({ legalName: `${tag} client` })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'client', number: tag, companyId: must(co).id, clientId: must(cl).id })
    .returning();
  await h.db.insert(assignment).values([
    { personId: id('solidity-cheap'), contractId: must(ct).id, fte: '0.5', startsOn: '2026-01-01' },
    { personId: id('rust'), contractId: must(ct).id, fte: '1', startsOn: '2026-01-01' },
  ]);
});

afterAll(() =>
  h.cleanup(async (db) => {
    const personIds = Object.values(ids);
    await db.delete(assignment).where(inArray(assignment.personId, personIds));
    await db.delete(person).where(inArray(person.id, personIds));
    await db.delete(contract).where(like(contract.number, tag));
    await db.delete(client).where(like(client.legalName, `${tag}%`));
  }),
);

const names = (rows: { fullName: string }[]) =>
  rows.map((r) => r.fullName.replace(`${tag} `, '')).sort();

describe('searchPeople (spec 6.2)', () => {
  it('AC: "Solidity, ≤ $50/h, available now"', async () => {
    const res = await searchPeople.run(h.ctxFor(viewer), {
      q: tag,
      stack: 'Solidity',
      maxRate: '50',
      availableOn: h.today,
    });
    expect(names(res._unsafeUnwrap())).toEqual(['solidity-cheap']);
  });

  it('matches stack tags case-insensitively and requires all tags', async () => {
    const all = await searchPeople.run(h.ctxFor(viewer), { q: tag, stack: 'SOLIDITY' });
    expect(names(all._unsafeUnwrap())).toHaveLength(4);
    const both = await searchPeople.run(h.ctxFor(viewer), {
      q: tag,
      stack: 'solidity, typescript',
    });
    expect(names(both._unsafeUnwrap())).toEqual(['solidity-cheap']);
  });

  it('computes bench status from active client assignments, visible to viewer', async () => {
    const res = (await searchPeople.run(h.ctxFor(viewer), { q: tag }))._unsafeUnwrap();
    const bench = Object.fromEntries(res.map((r) => [r.fullName.replace(`${tag} `, ''), r.bench]));
    expect(bench).toMatchObject({
      'solidity-cheap': 'partial',
      rust: 'busy',
      'solidity-pricey': 'free',
    });
    const busy = await searchPeople.run(h.ctxFor(viewer), { q: tag, bench: 'busy' });
    expect(names(busy._unsafeUnwrap())).toEqual(['rust']);
  });

  it('filters by allocation, seniority and status', async () => {
    const ctx = h.ctxFor(viewer);
    expect(
      names((await searchPeople.run(ctx, { q: tag, allocation: 'part_time' }))._unsafeUnwrap()),
    ).toEqual(['rust']);
    expect(
      names((await searchPeople.run(ctx, { q: tag, seniority: 'senior' }))._unsafeUnwrap()),
    ).toEqual(['solidity-cheap']);
    expect(
      names((await searchPeople.run(ctx, { q: tag, status: 'inactive' }))._unsafeUnwrap()),
    ).toEqual(['solidity-inactive']);
  });

  it('rejects malformed filters', async () => {
    const res = await searchPeople.run(h.ctxFor(viewer), { maxRate: 'fifty' });
    expect(res._unsafeUnwrapErr().code).toBe('validation_error');
  });
});

describe('person writes', () => {
  it('normalizes tags and keeps money as a decimal string', async () => {
    const card = (
      await getPerson.run(h.ctxFor(owner), { id: id('solidity-cheap') })
    )._unsafeUnwrap();
    expect(card.stack).toEqual(['Solidity', 'TypeScript']);
    expect(card.marketRateUsd).toBe('45.00000000');
  });

  it('updates and records the change in audit history', async () => {
    const res = await updatePerson.run(h.ctxFor(owner), {
      id: id('rust'),
      fullName: `${tag} rust`,
      stack: 'Rust, Solana',
      marketRateUsd: '35',
    });
    expect(res.isOk()).toBe(true);
    const card = (await getPerson.run(h.ctxFor(owner), { id: id('rust') }))._unsafeUnwrap();
    expect(card.stack).toEqual(['Rust', 'Solana']);
  });

  it('viewer cannot create people (RLS → forbidden)', async () => {
    const res = await createPerson.run(h.ctxFor(viewer), { fullName: `${tag} nope` });
    expect(res._unsafeUnwrapErr().code).toBe('forbidden');
  });

  it('returns not_found for unknown ids', async () => {
    const res = await getPerson.run(h.ctxFor(owner), { id: randomUUID() });
    expect(res._unsafeUnwrapErr().code).toBe('not_found');
  });
});
