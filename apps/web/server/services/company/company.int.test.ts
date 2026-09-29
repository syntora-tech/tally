import { company } from '@tally/db/schema';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { getCompany, saveCompany } from '.';

// The local database is shared with e2e and import tests, where contracts reference the company,
// so this test never deletes existing rows: it restores the original requisites instead.
const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
let original: typeof company.$inferSelect | undefined;

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  [original] = await h.db.select().from(company).orderBy(asc(company.createdAt)).limit(1);
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (original) {
      const { id, createdAt: _c, updatedAt: _u, createdBy: _b, ...values } = original;
      await db.update(company).set(values).where(eq(company.id, id));
    } else {
      await db.delete(company);
    }
  }),
);

describe('company requisites (6.10)', () => {
  it('owner saves the single company row; repeated saves update it', async () => {
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
    if (original) expect(first.id).toBe(original.id);
  });

  it('finance reads but cannot change requisites', async () => {
    const read = (await getCompany.run(h.ctxFor(finance), {}))._unsafeUnwrap();
    expect(read?.legalCode).toBe('46140580');
    const write = await saveCompany.run(h.ctxFor(finance), { nameEn: 'X', nameUa: 'X' });
    expect(write._unsafeUnwrapErr().code).toBe('forbidden');
  });
});
