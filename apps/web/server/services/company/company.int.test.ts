import { company } from '@tally/db/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { getCompany, saveCompany } from '.';

const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
let before: (typeof company.$inferSelect)[] = [];

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  before = await h.db.select().from(company);
});

afterAll(() =>
  h.cleanup(async (db) => {
    // Restore the pre-test state of the single-row company table.
    await db.delete(company);
    if (before.length) await db.insert(company).values(before);
  }),
);

describe('company requisites (6.10)', () => {
  it('owner creates then updates the single company row', async () => {
    await h.db.delete(company);
    const first = (
      await saveCompany.run(h.ctxFor(owner), { nameEn: 'LLC "SYNTORA"', nameUa: 'ТОВ «СІНТОРА»' })
    )._unsafeUnwrap();
    const second = (
      await saveCompany.run(h.ctxFor(owner), {
        nameEn: 'LLC "SYNTORA"',
        nameUa: 'ТОВ «СІНТОРА»',
        legalCode: '46140580',
      })
    )._unsafeUnwrap();
    expect(second.id).toBe(first.id);
    expect((await h.db.select().from(company)).length).toBe(1);
  });

  it('finance reads but cannot change requisites', async () => {
    const read = (await getCompany.run(h.ctxFor(finance), {}))._unsafeUnwrap();
    expect(read?.legalCode).toBe('46140580');
    const write = await saveCompany.run(h.ctxFor(finance), { nameEn: 'X', nameUa: 'X' });
    expect(write._unsafeUnwrapErr().code).toBe('forbidden');
  });
});
