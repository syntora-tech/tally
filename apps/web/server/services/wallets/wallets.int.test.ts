import { randomUUID } from 'node:crypto';
import { account, client, cryptoWallet, person } from '@tally/db/schema';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { saveAccount } from '../ledger';
import { addWallet, listWallets, updateWallet, upsertWallets } from '.';

const h = intHarness();
const tag = randomUUID().slice(0, 8);
const hex = randomUUID().replaceAll('-', '');
// Unique per run: addresses are unique across the shared local DB.
const evm = `0x${hex}${hex.slice(0, 8)}`.toUpperCase().replace('0X', '0x');
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
let personId: string;
let clientId: string;

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  [{ id: personId }] = (await h.db
    .insert(person)
    .values({ fullName: `W ${tag} Person` })
    .returning({ id: person.id })) as [{ id: string }];
  [{ id: clientId }] = (await h.db
    .insert(client)
    .values({ legalName: `W ${tag} Client` })
    .returning({ id: client.id })) as [{ id: string }];
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(account).where(like(account.name, `W ${tag}%`));
    await db.delete(person).where(eq(person.id, personId));
    await db.delete(client).where(eq(client.id, clientId));
  }),
);

it('stores several canonical wallets per person and refuses foreign or own addresses', async () => {
  const ctx = h.ctxFor(finance);
  const added = await addWallet.run(ctx, {
    personId,
    network: 'ETH',
    address: ` ${evm} `,
    label: 'MetaMask',
  });
  expect(added.isOk()).toBe(true);
  expect((await addWallet.run(ctx, { personId, network: 'BASE', address: evm })).isOk()).toBe(true);

  const [row] = await h.db
    .select()
    .from(cryptoWallet)
    .where(eq(cryptoWallet.id, added._unsafeUnwrap().id));
  expect(row?.address).toBe(evm.toLowerCase());

  const bad = await addWallet.run(ctx, { personId, network: 'TRON', address: evm });
  expect(bad._unsafeUnwrapErr().fieldErrors).toEqual({ address: ['field.walletAddress'] });

  const foreign = await addWallet.run(ctx, { clientId, network: 'ETH', address: evm });
  expect(foreign._unsafeUnwrapErr().fieldErrors?.address?.[0]).toMatch(/^wallets\.taken\|/);

  const ownAddress = `0x${hex.slice(0, 8)}${hex}`;
  await saveAccount.run(ctx, {
    name: `W ${tag} USDC`,
    kind: 'crypto',
    currency: 'USDC',
    network: 'ETH',
    address: ownAddress,
    openingBalance: '0',
    openingDate: '2026-01-01',
    isActive: 'on',
  });
  const own = await addWallet.run(ctx, { clientId, network: 'ETH', address: ownAddress });
  expect(own._unsafeUnwrapErr().fieldErrors?.address?.[0]).toMatch(/^wallets\.ownAccount\|/);

  const wallets = (await listWallets.run(ctx, { personId }))._unsafeUnwrap();
  expect(wallets.map((w) => w.network)).toEqual(['BASE', 'ETH']);

  await updateWallet.run(ctx, { id: added._unsafeUnwrap().id, label: 'Old', isActive: false });
  const after = (await listWallets.run(ctx, { personId }))._unsafeUnwrap();
  expect(after.at(-1)).toMatchObject({ network: 'ETH', label: 'Old', isActive: false });

  expect((await listWallets.run(h.ctxFor(viewer), { personId }))._unsafeUnwrap()).toEqual([]);
});

it('upserts wallets by address within the owner; dry run writes nothing', async () => {
  const ctx = h.ctxFor(finance);
  const tron = `T${(hex + hex).slice(0, 33).replace(/[0OIl]/g, 'a')}`;
  const item = { clientId, network: 'TRON' as const, address: tron, label: 'Treasury' };
  const dry = await upsertWallets.run(ctx, { wallets: [item], dryRun: true });
  expect(dry._unsafeUnwrap().wallets[0]?.status).toBe('created');
  expect(await h.db.select().from(cryptoWallet).where(eq(cryptoWallet.address, tron))).toHaveLength(
    0,
  );

  await upsertWallets.run(ctx, { wallets: [item] });
  const again = await upsertWallets.run(ctx, { wallets: [{ ...item, label: undefined }] });
  expect(again._unsafeUnwrap().wallets[0]?.status).toBe('unchanged');
  const off = await upsertWallets.run(ctx, { wallets: [{ ...item, isActive: false }] });
  expect(off._unsafeUnwrap().wallets[0]?.status).toBe('updated');

  const stolen = await upsertWallets.run(ctx, {
    wallets: [{ personId, network: 'TRON', address: tron }],
  });
  expect(Object.keys(stolen._unsafeUnwrapErr().fieldErrors ?? {})).toEqual(['wallets.0']);
});
