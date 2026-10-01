import { client, company, contract, payee } from '@tally/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import {
  createClient,
  createContract,
  getClient,
  getContract,
  listClients,
  updateContract,
} from '.';

const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
const clientIds: string[] = [];
const contractIds: string[] = [];
let payeeId = '';
let hadCompany = false;

beforeAll(async () => {
  owner = await h.user('owner');
  viewer = await h.user('viewer');
  hadCompany = (await h.db.select().from(company)).length > 0;
  const [p] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Щурко' })
    .returning();
  payeeId = p?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (contractIds.length) await db.delete(contract).where(inArray(contract.id, contractIds));
    if (clientIds.length) await db.delete(client).where(inArray(client.id, clientIds));
    await db.delete(payee).where(eq(payee.id, payeeId));
    if (!hadCompany) await db.delete(company);
  }),
);

describe('clients and contracts (spec 6.3)', () => {
  it('creates a client with structured contacts', async () => {
    const res = await createClient.run(h.ctxFor(owner), {
      legalName: 'Creditor Group Corp.',
      shortName: 'Creditor',
      defaultCurrency: 'usd',
      contacts: JSON.stringify([
        { name: 'Viktor Ihnatiuk', role: 'Director', email: 'v@example.com' },
      ]),
    });
    const { id } = res._unsafeUnwrap();
    clientIds.push(id);
    const card = (await getClient.run(h.ctxFor(owner), { id }))._unsafeUnwrap();
    expect(card.client.defaultCurrency).toBe('USD');
    expect(card.client.contacts).toEqual([
      { name: 'Viktor Ihnatiuk', role: 'Director', email: 'v@example.com' },
    ]);
  });

  it('refuses contracts until company requisites exist', async () => {
    if (hadCompany) return;
    const res = await createContract.run(h.ctxFor(owner), {
      kind: 'client',
      number: 'X',
      clientId: clientIds[0],
    });
    expect(res._unsafeUnwrapErr().message).toBe('company.missing');
  });

  it('creates client and FOP contracts with default date rules', async () => {
    if (!hadCompany)
      await h.db.insert(company).values({ nameEn: 'LLC "SYNTORA"', nameUa: 'ТОВ «СІНТОРА»' });
    const msa = (
      await createContract.run(h.ctxFor(owner), {
        kind: 'client',
        number: 'MSA №20-08/25',
        signedOn: '2025-08-20',
        clientId: clientIds[0],
      })
    )._unsafeUnwrap();
    contractIds.push(msa.id);
    const card = (await getContract.run(h.ctxFor(owner), { id: msa.id }))._unsafeUnwrap();
    expect(card.contract.paymentDueRule).toEqual({ type: 'day_of_month', day: 20 });
    expect(card.contract.actDateRule).toEqual({ type: 'last_working_day_of_period' });

    const fop = (
      await createContract.run(h.ctxFor(owner), {
        kind: 'fop',
        number: 'OD-1001',
        payeeId,
        currency: 'UAH',
        actDateRule: { type: 'manual' },
      })
    )._unsafeUnwrap();
    contractIds.push(fop.id);
  });

  it('rejects a client contract without a client (I9 in the schema)', async () => {
    const res = await createContract.run(h.ctxFor(owner), { kind: 'client', number: 'X', payeeId });
    expect(res._unsafeUnwrapErr().fieldErrors?.kind).toBeDefined();
  });

  it('updates rules', async () => {
    const res = await updateContract.run(h.ctxFor(owner), {
      id: contractIds[0],
      kind: 'client',
      number: 'MSA №20-08/25',
      clientId: clientIds[0],
      paymentDueRule: { type: 'net_days', days: 15 },
    });
    expect(res.isOk()).toBe(true);
    const card = (
      await getContract.run(h.ctxFor(owner), { id: contractIds[0] ?? '' })
    )._unsafeUnwrap();
    expect(card.contract.paymentDueRule).toEqual({ type: 'net_days', days: 15 });
  });

  it('viewer reads clients but not contracts', async () => {
    const list = (await listClients.run(h.ctxFor(viewer), {}))._unsafeUnwrap();
    expect(list.find((c) => c.id === clientIds[0])?.contracts).toBe(0);
    const card = (
      await getClient.run(h.ctxFor(viewer), { id: clientIds[0] ?? '' })
    )._unsafeUnwrap();
    expect(card.contracts).toHaveLength(0);
    const contractCard = await getContract.run(h.ctxFor(viewer), { id: contractIds[0] ?? '' });
    expect(contractCard._unsafeUnwrapErr().code).toBe('not_found');
  });
});
