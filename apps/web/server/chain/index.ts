import type { CryptoNetwork } from '@tally/domain';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';

/** One token transfer as the explorer reports it; `value` is in base units. */
export type ChainTransfer = {
  hash: string;
  logIndex: number;
  at: Date;
  from: string;
  to: string;
  contract: string;
  value: string;
};

export type ChainFailure = 'unavailable' | 'unsupported' | 'bad_response';

export type ChainReader = {
  tokenTransfers(input: {
    network: CryptoNetwork;
    address: string;
    contract: string;
    since: Date;
  }): Promise<Result<{ transfers: ChainTransfer[]; truncated: boolean }, ChainFailure>>;
  /** Who paid the network fee of a transaction and how much, in base units of the gas coin. */
  transactionFee(input: {
    network: CryptoNetwork;
    hash: string;
  }): Promise<Result<{ payer: string; fee: string }, ChainFailure>>;
};

const MAX_TRANSFERS = 2000;
const TIMEOUT_MS = 20_000;
const BLOCKSCOUT_PAGE = 100;

async function getJson(
  url: string,
  init: RequestInit = {},
): Promise<Result<unknown, ChainFailure>> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!response.ok) return err('unavailable');
    return ok(await response.json());
  } catch {
    return err('unavailable');
  }
}

const BLOCKSCOUT: Partial<Record<CryptoNetwork, string>> = {
  ETH: 'https://eth.blockscout.com',
};

// The Etherscan-style endpoint: v2 `token-transfers?token=` regularly times out on busy tokens like USDC.
const blockscoutTokenTx = z.object({
  status: z.string(),
  message: z.string(),
  result: z
    .array(
      z.object({
        hash: z.string(),
        timeStamp: z.coerce.number(),
        from: z.string(),
        to: z.string(),
        contractAddress: z.string(),
        value: z.string(),
      }),
    )
    .nullable(),
});

const blockscoutTx = z.object({
  from: z.object({ hash: z.string() }),
  fee: z.object({ value: z.string() }).nullable(),
});

const TRONGRID = 'https://api.trongrid.io';

const tronTransfers = z.object({
  data: z.array(
    z.object({
      transaction_id: z.string(),
      block_timestamp: z.number(),
      from: z.string(),
      to: z.string(),
      value: z.string(),
      token_info: z.object({ address: z.string() }),
    }),
  ),
  meta: z.object({ fingerprint: z.string().optional() }).optional(),
});

const tronTxInfo = z.object({ fee: z.number().optional() });
const tronTx = z.object({
  raw_data: z.object({
    contract: z.array(
      z.object({ parameter: z.object({ value: z.object({ owner_address: z.string() }) }) }),
    ),
  }),
});

/** Public explorers (A-122): Blockscout for Ethereum, TronGrid for TRON; read-only, no keys needed. */
export function chainReader(options: { trongridApiKey?: string } = {}): ChainReader {
  const tronHeaders: Record<string, string> = options.trongridApiKey
    ? { 'TRON-PRO-API-KEY': options.trongridApiKey }
    : {};
  return {
    async tokenTransfers({ network, address, contract, since }) {
      if (network === 'TRON') {
        const transfers: ChainTransfer[] = [];
        let fingerprint: string | undefined;
        do {
          const q = new URLSearchParams({
            only_confirmed: 'true',
            limit: '200',
            contract_address: contract,
            min_timestamp: String(since.getTime()),
            order_by: 'block_timestamp,asc',
          });
          if (fingerprint) q.set('fingerprint', fingerprint);
          const raw = await getJson(
            `${TRONGRID}/v1/accounts/${address}/transactions/trc20?${q.toString()}`,
            {
              headers: tronHeaders,
            },
          );
          if (raw.isErr()) return err(raw.error);
          const page = tronTransfers.safeParse(raw.value);
          if (!page.success) return err('bad_response');
          for (const t of page.data.data) {
            transfers.push({
              hash: t.transaction_id,
              logIndex: 0,
              at: new Date(t.block_timestamp),
              from: t.from,
              to: t.to,
              contract: t.token_info.address,
              value: t.value,
            });
          }
          fingerprint = page.data.meta?.fingerprint;
        } while (fingerprint && transfers.length < MAX_TRANSFERS);
        return ok({ transfers, truncated: Boolean(fingerprint) });
      }
      const base = BLOCKSCOUT[network];
      if (!base) return err('unsupported');
      const transfers: ChainTransfer[] = [];
      const perHash = new Map<string, number>();
      let page = 1;
      let more = true;
      // Newest first: stop at the first page that reaches back past `since`.
      while (more && transfers.length < MAX_TRANSFERS) {
        const q = new URLSearchParams({
          module: 'account',
          action: 'tokentx',
          address,
          contractaddress: contract,
          sort: 'desc',
          page: String(page),
          offset: String(BLOCKSCOUT_PAGE),
        });
        const raw = await getJson(`${base}/api?${q.toString()}`);
        if (raw.isErr()) return err(raw.error);
        const parsed = blockscoutTokenTx.safeParse(raw.value);
        if (!parsed.success) return err('bad_response');
        const items = parsed.data.result ?? [];
        if (
          parsed.data.status !== '1' &&
          items.length === 0 &&
          !/no token transfers/i.test(parsed.data.message)
        )
          return err('bad_response');
        let reachedSince = false;
        for (const t of items) {
          const at = new Date(t.timeStamp * 1000);
          if (at < since) {
            reachedSince = true;
            continue;
          }
          // No log index here; an ordinal within the transaction keeps batch transfers apart.
          const logIndex = perHash.get(t.hash) ?? 0;
          perHash.set(t.hash, logIndex + 1);
          transfers.push({
            hash: t.hash,
            logIndex,
            at,
            from: t.from,
            to: t.to,
            contract: t.contractAddress,
            value: t.value,
          });
        }
        more = !reachedSince && items.length === BLOCKSCOUT_PAGE;
        page++;
      }
      return ok({ transfers, truncated: more });
    },

    async transactionFee({ network, hash }) {
      if (network === 'TRON') {
        const [info, tx] = await Promise.all([
          getJson(`${TRONGRID}/wallet/gettransactioninfobyid`, {
            method: 'POST',
            headers: { ...tronHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ value: hash }),
          }),
          getJson(`${TRONGRID}/wallet/gettransactionbyid`, {
            method: 'POST',
            headers: { ...tronHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ value: hash, visible: true }),
          }),
        ]);
        if (info.isErr()) return err(info.error);
        if (tx.isErr()) return err(tx.error);
        const parsedInfo = tronTxInfo.safeParse(info.value);
        const parsedTx = tronTx.safeParse(tx.value);
        const payer = parsedTx.success
          ? parsedTx.data.raw_data.contract[0]?.parameter.value.owner_address
          : undefined;
        if (!parsedInfo.success || !payer) return err('bad_response');
        return ok({ payer, fee: String(parsedInfo.data.fee ?? 0) });
      }
      const base = BLOCKSCOUT[network];
      if (!base) return err('unsupported');
      const raw = await getJson(`${base}/api/v2/transactions/${hash}`);
      if (raw.isErr()) return err(raw.error);
      const parsed = blockscoutTx.safeParse(raw.value);
      if (!parsed.success) return err('bad_response');
      return ok({ payer: parsed.data.from.hash, fee: parsed.data.fee?.value ?? '0' });
    },
  };
}
