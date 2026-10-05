import { err, ok, type Result } from 'neverthrow';

/** Networks a wallet or crypto account can live on; the DB check constraints mirror this list. */
export const CRYPTO_NETWORKS = [
  'ETH',
  'BSC',
  'POLYGON',
  'ARBITRUM',
  'BASE',
  'OPTIMISM',
  'AVALANCHE',
  'TRON',
  'SOLANA',
  'BTC',
  'TON',
] as const;

export type CryptoNetwork = (typeof CRYPTO_NETWORKS)[number];

/** Display names; proper nouns, the same in every UI language. */
export const CRYPTO_NETWORK_NAMES: Record<CryptoNetwork, string> = {
  ETH: 'Ethereum',
  BSC: 'BNB Smart Chain',
  POLYGON: 'Polygon',
  ARBITRUM: 'Arbitrum One',
  BASE: 'Base',
  OPTIMISM: 'Optimism',
  AVALANCHE: 'Avalanche C-Chain',
  TRON: 'TRON',
  SOLANA: 'Solana',
  BTC: 'Bitcoin',
  TON: 'TON',
};

/** `0x5290…9ee7`: enough to recognise an address in tables without breaking the layout. */
export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const EVM: readonly CryptoNetwork[] = [
  'ETH',
  'BSC',
  'POLYGON',
  'ARBITRUM',
  'BASE',
  'OPTIMISM',
  'AVALANCHE',
];

const BASE58 = '[1-9A-HJ-NP-Za-km-z]';

const FORMATS: Record<CryptoNetwork, RegExp> = {
  ...(Object.fromEntries(EVM.map((n) => [n, /^0x[0-9a-fA-F]{40}$/])) as Record<
    (typeof EVM)[number],
    RegExp
  >),
  TRON: new RegExp(`^T${BASE58}{33}$`),
  SOLANA: new RegExp(`^${BASE58}{32,44}$`),
  BTC: new RegExp(`^(bc1[02-9ac-hj-np-z]{8,87}|[13]${BASE58}{25,34})$`),
  TON: /^([A-Za-z0-9_+/-]{48}|-?\d+:[0-9a-fA-F]{64})$/,
};

export function isCryptoNetwork(value: string): value is CryptoNetwork {
  return (CRYPTO_NETWORKS as readonly string[]).includes(value);
}

const NETWORK_ALIASES: Record<string, CryptoNetwork> = {
  ERC20: 'ETH',
  ETHEREUM: 'ETH',
  BEP20: 'BSC',
  BNB: 'BSC',
  TRC20: 'TRON',
  SOL: 'SOLANA',
  MATIC: 'POLYGON',
  BITCOIN: 'BTC',
};

/** Network code from loose spellings in imported sheets ("Tron", "TRC20", "erc20"); else null. */
export function parseCryptoNetwork(raw: string): CryptoNetwork | null {
  const key = raw.trim().toUpperCase();
  if (isCryptoNetwork(key)) return key;
  return NETWORK_ALIASES[key] ?? null;
}

export type WalletAddressError = { code: 'invalid_address'; network: CryptoNetwork };

/**
 * Validates an address for its network and returns the canonical form used for uniqueness and
 * matching Ledger counterparties: EVM addresses and bech32 BTC are case-insensitive, so they are
 * lower-cased; base58/base64 formats are case-sensitive and kept as typed.
 */
export function normalizeWalletAddress(
  network: CryptoNetwork,
  address: string,
): Result<string, WalletAddressError> {
  const trimmed = address.trim();
  const caseless = EVM.includes(network) || /^bc1/i.test(trimmed);
  const canonical = caseless ? trimmed.toLowerCase() : trimmed;
  return FORMATS[network].test(canonical)
    ? ok(canonical)
    : err({ code: 'invalid_address', network });
}

const EXPLORER_TX: Record<CryptoNetwork, string> = {
  ETH: 'https://etherscan.io/tx/',
  BSC: 'https://bscscan.com/tx/',
  POLYGON: 'https://polygonscan.com/tx/',
  ARBITRUM: 'https://arbiscan.io/tx/',
  BASE: 'https://basescan.org/tx/',
  OPTIMISM: 'https://optimistic.etherscan.io/tx/',
  AVALANCHE: 'https://snowtrace.io/tx/',
  TRON: 'https://tronscan.org/#/transaction/',
  SOLANA: 'https://solscan.io/tx/',
  BTC: 'https://mempool.space/tx/',
  TON: 'https://tonviewer.com/transaction/',
};

const TX_HASH: Record<CryptoNetwork, RegExp> = {
  ...(Object.fromEntries(EVM.map((n) => [n, /^0x[0-9a-fA-F]{64}$/])) as Record<
    (typeof EVM)[number],
    RegExp
  >),
  TRON: /^[0-9a-fA-F]{64}$/,
  BTC: /^[0-9a-fA-F]{64}$/,
  SOLANA: new RegExp(`^${BASE58}{64,90}$`),
  TON: /^([0-9a-fA-F]{64}|[A-Za-z0-9_+/-]{43}=?)$/,
};

/** Explorer page of a transaction hash on its network, or null when the text is not such a hash. */
export function explorerTxUrl(network: CryptoNetwork, hash: string): string | null {
  const trimmed = hash.trim();
  return TX_HASH[network].test(trimmed)
    ? `${EXPLORER_TX[network]}${encodeURIComponent(trimmed)}`
    : null;
}

const URL_IN_TEXT = /https?:\/\/[^\s)]+/g;
const EXPLORER_HOSTS = Object.values(EXPLORER_TX).map((u) => new URL(u).host);

/**
 * Explorer link for a Ledger transaction: its `externalRef` hash on the account network, else an
 * explorer URL or EVM hash pasted into the description (legacy rows keep hashes there).
 */
export function transactionExplorerUrl(
  network: CryptoNetwork | null,
  externalRef: string | null,
  description: string | null,
): string | null {
  if (network && externalRef) {
    const byRef = explorerTxUrl(network, externalRef);
    if (byRef) return byRef;
  }
  for (const url of description?.match(URL_IN_TEXT) ?? []) {
    if (EXPLORER_HOSTS.includes(new URL(url).host)) return url;
  }
  const evmHash = description?.match(/\b0x[0-9a-fA-F]{64}\b/)?.[0];
  return network && evmHash ? explorerTxUrl(network, evmHash) : null;
}
