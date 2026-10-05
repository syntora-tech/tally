import { describe, expect, it } from 'vitest';
import {
  explorerTxUrl,
  isCryptoNetwork,
  normalizeWalletAddress,
  parseCryptoNetwork,
  transactionExplorerUrl,
} from './crypto';

describe('normalizeWalletAddress', () => {
  it('lower-cases EVM addresses on every EVM network', () => {
    const mixed = '  0x52908400098527886E0F7030069857D2E4169EE7 ';
    expect(normalizeWalletAddress('ETH', mixed)._unsafeUnwrap()).toBe(
      '0x52908400098527886e0f7030069857d2e4169ee7',
    );
    expect(normalizeWalletAddress('BASE', mixed).isOk()).toBe(true);
  });

  it('keeps case-sensitive formats as typed', () => {
    const tron = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
    expect(normalizeWalletAddress('TRON', tron)._unsafeUnwrap()).toBe(tron);
    const sol = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
    expect(normalizeWalletAddress('SOLANA', sol)._unsafeUnwrap()).toBe(sol);
    const ton = 'EQDtFpEwcFAEcRe5mLVh2N6C0x-_hJEM7W61_JLnSF74p4q2';
    expect(normalizeWalletAddress('TON', ton)._unsafeUnwrap()).toBe(ton);
  });

  it('accepts legacy and bech32 bitcoin addresses', () => {
    expect(normalizeWalletAddress('BTC', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').isOk()).toBe(true);
    expect(
      normalizeWalletAddress('BTC', 'BC1QAR0SRRR7XFKVY5L643LYDNW9RE59GTZZWF5MDQ')._unsafeUnwrap(),
    ).toBe('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq');
  });

  it('rejects an address of another network', () => {
    expect(
      normalizeWalletAddress(
        'TRON',
        '0x52908400098527886E0F7030069857D2E4169EE7',
      )._unsafeUnwrapErr(),
    ).toEqual({ code: 'invalid_address', network: 'TRON' });
    expect(normalizeWalletAddress('ETH', '0x123').isErr()).toBe(true);
    expect(normalizeWalletAddress('SOLANA', '0OIl' + 'a'.repeat(40)).isErr()).toBe(true);
  });
});

describe('parseCryptoNetwork', () => {
  it('maps loose spellings to codes', () => {
    expect(parseCryptoNetwork(' Tron ')).toBe('TRON');
    expect(parseCryptoNetwork('erc20')).toBe('ETH');
    expect(parseCryptoNetwork('TRC20')).toBe('TRON');
    expect(parseCryptoNetwork('Lightning')).toBeNull();
  });
});

describe('isCryptoNetwork', () => {
  it('knows only the listed networks', () => {
    expect(isCryptoNetwork('TRON')).toBe(true);
    expect(isCryptoNetwork('tron')).toBe(false);
  });
});

describe('explorer links', () => {
  const evm = `0x${'a1'.repeat(32)}`;
  const tron = 'b2'.repeat(32);

  it('builds the explorer URL of a hash on its network', () => {
    expect(explorerTxUrl('ETH', evm)).toBe(`https://etherscan.io/tx/${evm}`);
    expect(explorerTxUrl('TRON', tron)).toBe(`https://tronscan.org/#/transaction/${tron}`);
    expect(explorerTxUrl('TRON', evm)).toBeNull();
  });

  it('prefers externalRef, then an explorer URL or hash in the description', () => {
    expect(transactionExplorerUrl('BSC', evm, null)).toBe(`https://bscscan.com/tx/${evm}`);
    expect(
      transactionExplorerUrl('ETH', null, `D.Energy - https://etherscan.io/tx/${evm} paid`),
    ).toBe(`https://etherscan.io/tx/${evm}`);
    expect(transactionExplorerUrl('ETH', 'PB-123', `fee ${evm}`)).toBe(
      `https://etherscan.io/tx/${evm}`,
    );
    expect(transactionExplorerUrl(null, null, 'see https://example.com/tx/1')).toBeNull();
    expect(transactionExplorerUrl(null, evm, null)).toBeNull();
  });
});
