import { CRYPTO_NETWORK_CODES } from '@tally/db/schema';
import { CRYPTO_NETWORKS } from '@tally/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { normalizeAddressIn, optionalNetwork } from './fields';

describe('crypto networks', () => {
  it('match the DB check constraints', () => {
    expect([...CRYPTO_NETWORK_CODES]).toEqual([...CRYPTO_NETWORKS]);
  });
});

describe('normalizeAddressIn', () => {
  const schema = z
    .object({ network: optionalNetwork, address: z.string().nullable() })
    .transform(normalizeAddressIn('network', 'address'));

  it('canonicalises an address of its network', () => {
    expect(
      schema.parse({ network: 'ETH', address: '0x52908400098527886E0F7030069857D2E4169EE7' }),
    ).toEqual({ network: 'ETH', address: '0x52908400098527886e0f7030069857d2e4169ee7' });
    expect(schema.parse({ network: '', address: null })).toEqual({ network: null, address: null });
  });

  it('reports a missing network and a foreign address on the right field', () => {
    const noNetwork = schema.safeParse({ network: '', address: 'Tabc' });
    expect(noNetwork.error?.issues[0]).toMatchObject({
      path: ['network'],
      message: 'field.networkRequired',
    });
    const foreign = schema.safeParse({ network: 'TRON', address: '0x1' });
    expect(foreign.error?.issues[0]).toMatchObject({
      path: ['address'],
      message: 'field.walletAddress',
    });
  });
});
