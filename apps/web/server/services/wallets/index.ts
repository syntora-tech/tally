import type { DbTransaction } from '@tally/db';
import { account, client, cryptoWallet, person } from '@tally/db/schema';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScopeAtomic } from '../atomic';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { msg, serviceError } from '../errors';
import { checkbox, cryptoNetwork, normalizeAddressIn, optionalText, requiredText } from '../fields';

// Crypto wallets of people and clients (A-060): several per owner, one owner per (network,
// address), deactivated instead of deleted so past Ledger transactions stay identifiable.

const ownerShape = {
  personId: z.uuid().optional().describe('Owner person id; exactly one of personId and clientId'),
  clientId: z.uuid().optional().describe('Owner client id; exactly one of personId and clientId'),
};

const oneOwner = (v: { personId?: string; clientId?: string }) =>
  Boolean(v.personId) !== Boolean(v.clientId);

const network = cryptoNetwork.describe(
  'ETH, BSC, POLYGON, ARBITRUM, BASE, OPTIMISM, AVALANCHE, TRON, SOLANA, BTC or TON',
);

export const walletInput = z
  .object({
    ...ownerShape,
    network,
    address: requiredText('field.walletAddress').describe('Address as shown by the explorer'),
    label: optionalText.describe('Free note, e.g. "Binance deposit" or "Trust Wallet"'),
    isActive: checkbox.default(true),
  })
  .refine(oneOwner, { message: 'wallets.owner', path: ['personId'] })
  .transform(normalizeAddressIn('network', 'address'));

export type WalletOwner = { personId: string } | { clientId: string };

export type WalletRow = {
  id: string;
  network: string;
  address: string;
  label: string | null;
  isActive: boolean;
};

const walletColumns = {
  id: cryptoWallet.id,
  network: cryptoWallet.network,
  address: cryptoWallet.address,
  label: cryptoWallet.label,
  isActive: cryptoWallet.isActive,
};

/** Active wallets first, then by network; for person/client cards and MCP. */
export async function walletsOf(
  tx: DbTransaction,
  owners: { personIds?: string[]; clientIds?: string[] },
): Promise<(WalletRow & { personId: string | null; clientId: string | null })[]> {
  const personIds = owners.personIds ?? [];
  const clientIds = owners.clientIds ?? [];
  if (!personIds.length && !clientIds.length) return [];
  return tx
    .select({ ...walletColumns, personId: cryptoWallet.personId, clientId: cryptoWallet.clientId })
    .from(cryptoWallet)
    .where(
      sql`${personIds.length ? inArray(cryptoWallet.personId, personIds) : sql`false`} or ${
        clientIds.length ? inArray(cryptoWallet.clientId, clientIds) : sql`false`
      }`,
    )
    .orderBy(desc(cryptoWallet.isActive), asc(cryptoWallet.network), asc(cryptoWallet.address));
}

type Conflict = { key: string; values?: Record<string, string> };

/** Why (network, address) cannot be given to `owner`: it is ours or belongs to someone else. */
async function addressConflict(
  tx: DbTransaction,
  network: string,
  address: string,
  owner: { personId?: string; clientId?: string },
): Promise<Conflict | null> {
  const [own] = await tx
    .select({ name: account.name })
    .from(account)
    .where(and(eq(account.network, network), eq(account.address, address)));
  if (own) return { key: 'wallets.ownAccount', values: { name: own.name } };
  const [taken] = await tx
    .select({
      id: cryptoWallet.id,
      personId: cryptoWallet.personId,
      clientId: cryptoWallet.clientId,
      ownerName: sql<string>`coalesce(${person.fullName}, ${client.shortName}, ${client.legalName})`,
    })
    .from(cryptoWallet)
    .leftJoin(person, eq(person.id, cryptoWallet.personId))
    .leftJoin(client, eq(client.id, cryptoWallet.clientId))
    .where(and(eq(cryptoWallet.network, network), eq(cryptoWallet.address, address)));
  if (!taken) return null;
  const sameOwner =
    (owner.personId && taken.personId === owner.personId) ||
    (owner.clientId && taken.clientId === owner.clientId);
  return sameOwner
    ? { key: 'wallets.duplicate' }
    : { key: 'wallets.taken', values: { owner: taken.ownerName } };
}

const conflictMessage = (c: Conflict) => (c.values ? msg(c.key, c.values) : c.key);

export const listWallets = defineService({
  name: 'wallets.list',
  input: z.object(ownerShape).refine(oneOwner, { message: 'wallets.owner', path: ['personId'] }),
  handler: async (ctx, { personId, clientId }) =>
    ok(
      await inActorScope(ctx, (tx) =>
        walletsOf(tx, {
          personIds: personId ? [personId] : [],
          clientIds: clientId ? [clientId] : [],
        }),
      ),
    ),
});

export const addWallet = defineService({
  name: 'wallets.add',
  input: walletInput,
  handler: async (ctx, input) =>
    inActorScope(ctx, async (tx) => {
      const conflict = await addressConflict(tx, input.network, input.address, input);
      if (conflict) {
        return err(
          serviceError('conflict', conflictMessage(conflict), {
            address: [conflictMessage(conflict)],
          }),
        );
      }
      const [row] = await tx
        .insert(cryptoWallet)
        .values({
          personId: input.personId ?? null,
          clientId: input.clientId ?? null,
          network: input.network,
          address: input.address,
          label: input.label,
          isActive: input.isActive,
        })
        .returning({ id: cryptoWallet.id });
      return row ? ok(row) : err(serviceError('forbidden', 'general.forbidden'));
    }),
});

/** Only the note and the active flag change; a different address is a different wallet. */
export const updateWallet = defineService({
  name: 'wallets.update',
  input: z.object({
    id: z.uuid(),
    label: optionalText,
    isActive: checkbox,
  }),
  handler: async (ctx, { id, label, isActive }) => {
    const [row] = await inActorScope(ctx, (tx) =>
      tx
        .update(cryptoWallet)
        .set({ label, isActive })
        .where(eq(cryptoWallet.id, id))
        .returning({ id: cryptoWallet.id }),
    );
    return row ? ok(row) : err(serviceError('not_found', 'wallets.notFound'));
  },
});

const walletItem = z
  .object({
    ...ownerShape,
    network,
    address: z.string().trim().min(1).describe('Address as shown by the explorer'),
    label: optionalText.optional().describe('Free note; omit to keep the stored one'),
    isActive: z.boolean().optional().describe('false deactivates; omit to keep the stored flag'),
  })
  .refine(oneOwner, { message: 'wallets.owner', path: ['personId'] })
  .transform(normalizeAddressIn('network', 'address'));

/**
 * Wallets in bulk for agents (A-060): matched by (network, address) within the owner; a new
 * address is added, a known one gets the label/active flag sent. An address owned by someone
 * else or by our own account is an item error.
 */
export const upsertWallets = defineService({
  name: 'wallets.upsertBatch',
  input: z.object({
    wallets: z.array(walletItem).min(1).max(200),
    dryRun: z.boolean().default(false).describe('Validate and preview without writing'),
  }),
  handler: (ctx, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      const errors: Record<string, string[]> = {};
      const results: { index: number; id: string; status: 'created' | 'updated' | 'unchanged' }[] =
        [];
      for (const [index, item] of input.wallets.entries()) {
        const key = `wallets.${String(index)}`;
        const [current] = await tx
          .select()
          .from(cryptoWallet)
          .where(
            and(eq(cryptoWallet.network, item.network), eq(cryptoWallet.address, item.address)),
          );
        // The owner's own wallet is the one to update, not a conflict.
        const conflict = await addressConflict(tx, item.network, item.address, item);
        if (conflict && conflict.key !== 'wallets.duplicate') {
          errors[key] = [conflictMessage(conflict)];
          continue;
        }
        if (!current) {
          const [row] = await tx
            .insert(cryptoWallet)
            .values({
              personId: item.personId ?? null,
              clientId: item.clientId ?? null,
              network: item.network,
              address: item.address,
              label: item.label ?? null,
              isActive: item.isActive ?? true,
            })
            .returning({ id: cryptoWallet.id });
          if (!row) return err(serviceError('forbidden', 'general.forbidden'));
          results.push({ index, id: row.id, status: 'created' });
          continue;
        }
        const label = item.label === undefined ? current.label : item.label;
        const isActive = item.isActive ?? current.isActive;
        if (label === current.label && isActive === current.isActive) {
          results.push({ index, id: current.id, status: 'unchanged' });
          continue;
        }
        await tx
          .update(cryptoWallet)
          .set({ label, isActive })
          .where(eq(cryptoWallet.id, current.id));
        results.push({ index, id: current.id, status: 'updated' });
      }
      return Object.keys(errors).length
        ? err(
            serviceError(
              'validation_error',
              msg('batch.failedItems', { count: Object.keys(errors).length }),
              errors,
            ),
          )
        : ok({ wallets: results });
    }),
});
