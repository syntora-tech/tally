import { payee, person } from '@tally/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { getPerson } from '../people';
import { createPayee, getPayee, listPayees, setDefaultPayee } from '.';

const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
let personId = '';
const payeeIds: string[] = [];

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  const [p] = await h.db.insert(person).values({ fullName: 'Vladyslav (CTO)' }).returning();
  personId = p?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, personId));
    if (payeeIds.length) await db.delete(payee).where(inArray(payee.id, payeeIds));
    await db.delete(person).where(eq(person.id, personId));
  }),
);

describe('payees', () => {
  it('creates a FOP payee with a normalized IBAN, linked to another person', async () => {
    const res = await createPayee.run(h.ctxFor(finance), {
      kind: 'fop',
      legalNameUa: 'ФОП Езерович Д. М.',
      taxId: '1234567890',
      iban: 'ua21 3223 1300 0002 6007 2335 6600 1',
      personId,
    });
    const { id } = res._unsafeUnwrap();
    payeeIds.push(id);
    const card = (await getPayee.run(h.ctxFor(owner), { id }))._unsafeUnwrap();
    expect(card.payee.iban).toBe('UA213223130000026007233566001');
    expect(card.personName).toBe('Vladyslav (CTO)');
  });

  it('validates names, IBAN, tax id and crypto wallets', async () => {
    const res = await createPayee.run(h.ctxFor(finance), {
      kind: 'crypto',
      iban: 'not-an-iban',
      taxId: 'abc',
    });
    const fields = res._unsafeUnwrapErr().fieldErrors ?? {};
    expect(Object.keys(fields).sort()).toEqual(['iban', 'legalNameUa', 'taxId', 'walletAddress']);

    const noWallet = await createPayee.run(h.ctxFor(finance), {
      kind: 'crypto',
      legalNameEn: 'USDT',
    });
    expect(noWallet._unsafeUnwrapErr().fieldErrors?.walletAddress).toBeDefined();
    const noName = await createPayee.run(h.ctxFor(finance), { kind: 'fop' });
    expect(noName._unsafeUnwrapErr().fieldErrors?.legalNameUa).toBeDefined();
  });

  it('sets the default payee shown on the person card for finance', async () => {
    const payeeId = payeeIds[0] ?? '';
    expect((await setDefaultPayee.run(h.ctxFor(finance), { personId, payeeId })).isOk()).toBe(true);
    const card = (await getPerson.run(h.ctxFor(finance), { id: personId }))._unsafeUnwrap();
    expect(card.defaultPayee).toEqual({ id: payeeId, name: 'ФОП Езерович Д. М.' });
  });

  it('AC 6.2: viewer sees neither payees nor the default payee on the person card', async () => {
    expect((await listPayees.run(h.ctxFor(viewer), {}))._unsafeUnwrap()).toHaveLength(0);
    expect(
      (await getPayee.run(h.ctxFor(viewer), { id: payeeIds[0] ?? '' }))._unsafeUnwrapErr().code,
    ).toBe('not_found');
    const card = (await getPerson.run(h.ctxFor(viewer), { id: personId }))._unsafeUnwrap();
    expect(card.defaultPayee).toBeNull();
    const write = await createPayee.run(h.ctxFor(viewer), { kind: 'other', legalNameEn: 'X' });
    expect(write._unsafeUnwrapErr().code).toBe('forbidden');
  });
});
