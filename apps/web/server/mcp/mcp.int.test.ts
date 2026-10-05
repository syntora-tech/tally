import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  account,
  auditLog,
  client,
  mcpCallLog,
  mcpClientPolicy,
  payee,
  person,
  transaction,
} from '@tally/db/schema';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../test/int-helpers';
import { createMcpClient, revokeMcpClient } from '../services/mcp';
import { handleMcpRequest, type McpHttpDeps } from './http';
import { createMcpServer, type McpStore } from './server';
import * as store from './store';

const h = intHarness('2046-02-10');
const tag = randomUUID().slice(0, 8);
const usd = `M ${tag} USD`;
let owner: Awaited<ReturnType<typeof h.user>>;
let assistantToken = '';
let readOnlyToken = '';
const clientIds: string[] = [];

const mcpStore: McpStore = {
  recentCalls: (clientId, tools) => store.recentCalls(h.db, clientId, tools),
  logCall: (entry) => store.logCall(h.db, entry),
  findIdempotent: (clientId, key) => store.findIdempotent(h.db, clientId, key),
  saveIdempotent: (entry) => store.saveIdempotent(h.db, entry),
};

const deps: McpHttpDeps = {
  db: h.db,
  today: h.today,
  config: { allowedEmails: [] },
  store: mcpStore,
  findClient: (token) => store.findClientByToken(h.db, token),
  tokenExists: (token) => store.tokenExists(h.db, token),
};

async function connect(token: string) {
  const client = await store.findClientByToken(h.db, token);
  if (!client) throw new Error('no client');
  const server = createMcpServer({ ...deps, client });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: 'int-test', version: '1' });
  await mcp.connect(b);
  return mcp;
}

type ToolResult = { isError?: boolean; structuredContent?: Record<string, unknown> };

beforeAll(async () => {
  owner = await h.user('owner');
  const ctx = h.ctxFor(owner);
  const assistant = (
    await createMcpClient.run(ctx, { clientName: `int ${tag}`, profile: 'assistant' })
  )._unsafeUnwrap();
  const readOnly = (
    await createMcpClient.run(ctx, { clientName: `int ${tag} ro` })
  )._unsafeUnwrap();
  assistantToken = assistant.token;
  readOnlyToken = readOnly.token;
  clientIds.push(assistant.clientId, readOnly.clientId);
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(transaction).where(like(transaction.externalRef, `mcp:${tag}:%`));
    await db.delete(account).where(like(account.name, `M ${tag}%`));
    await db.delete(payee).where(like(payee.legalNameUa, `ФОП M ${tag}%`));
    await db.delete(person).where(like(person.fullName, `M ${tag}%`));
    await db.delete(client).where(like(client.legalName, `M ${tag}%`));
    await db.delete(mcpCallLog).where(inArray(mcpCallLog.clientId, clientIds));
    await db.delete(mcpClientPolicy).where(inArray(mcpClientPolicy.clientId, clientIds));
  }),
);

const rpc = (token: string | null, body: unknown) =>
  handleMcpRequest(
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    deps,
  );

describe('MCP server (13.3–13.6, A-054)', () => {
  it('rejects missing and unknown tokens with 401', async () => {
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const missing = await rpc(null, list);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toContain('Bearer');
    expect((await rpc(`tally_pat_${'x'.repeat(43)}`, list)).status).toBe(401);
  });

  it('serves tools/list over stateless HTTP', async () => {
    const response = await rpc(readOnlyToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toEqual([
      'get_balances',
      'list_categories',
      'list_transactions',
      'list_fx_rates',
      'search_people',
      'get_person',
      'list_clients',
      'find_wallets',
      'list_payees',
    ]);
  });

  it('lists only the tools of the profile; write tools require an idempotency key', async () => {
    const mcp = await connect(assistantToken);
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(18);
    const add = tools.find((t) => t.name === 'add_transactions');
    expect(add?.inputSchema.required).toContain('idempotencyKey');
    expect(add?.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true });

    const ro = await connect(readOnlyToken);
    const denied = (await ro.callTool({
      name: 'upsert_accounts',
      arguments: { accounts: [], idempotencyKey: 'x'.repeat(10) },
    })) as ToolResult;
    expect(denied.isError).toBe(true);
  });

  it('writes once per idempotency key, audits via mcp, and dry runs leave no trace', async () => {
    const mcp = await connect(assistantToken);
    const accounts = {
      accounts: [
        {
          name: usd,
          kind: 'bank',
          currency: 'USD',
          openingBalance: '100',
          openingDate: '2046-01-01',
        },
      ],
    };
    const noKey = (await mcp.callTool({
      name: 'upsert_accounts',
      arguments: accounts,
    })) as ToolResult;
    expect(noKey.isError).toBe(true);
    await mcp.callTool({
      name: 'upsert_accounts',
      arguments: { ...accounts, idempotencyKey: `acc-${tag}` },
    });

    const batch = {
      transactions: [
        {
          externalRef: `mcp:${tag}:1`,
          occurredOn: '2046-01-05',
          type: 'revenue',
          category: 'Client Revenue',
          to: { account: usd, amount: '50' },
        },
      ],
    };
    const dry = (await mcp.callTool({
      name: 'add_transactions',
      arguments: { ...batch, dryRun: true, idempotencyKey: `tx-${tag}-dry` },
    })) as ToolResult;
    expect(dry.structuredContent).toMatchObject({ created: 1 });
    expect(
      await h.db
        .select()
        .from(transaction)
        .where(eq(transaction.externalRef, `mcp:${tag}:1`)),
    ).toHaveLength(0);

    const args = { ...batch, idempotencyKey: `tx-${tag}` };
    const first = (await mcp.callTool({ name: 'add_transactions', arguments: args })) as ToolResult;
    const second = (await mcp.callTool({
      name: 'add_transactions',
      arguments: args,
    })) as ToolResult;
    expect(first.structuredContent).toMatchObject({ created: 1 });
    expect(second.structuredContent).toEqual(first.structuredContent);

    const [row] = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.externalRef, `mcp:${tag}:1`));
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tableName, 'transaction'), eq(auditLog.rowId, row?.id ?? '')));
    expect(audit[0]).toMatchObject({ via: 'mcp', clientId: clientIds[0], actor: owner.id });

    const balances = (await mcp.callTool({ name: 'get_balances', arguments: {} })) as ToolResult;
    const items = balances.structuredContent?.items as { name: string; balance: string }[];
    expect(items.find((a) => a.name === usd)?.balance).toBe('150.00000000');

    const edited = (await mcp.callTool({
      name: 'update_transactions',
      arguments: {
        idempotencyKey: `edit-${tag}`,
        transactions: [
          { id: row?.id, description: 'Corrected by agent', to: { account: usd, amount: '40' } },
        ],
      },
    })) as ToolResult;
    expect(edited.structuredContent).toMatchObject({ transactions: [{ status: 'updated' }] });
    const after = (await mcp.callTool({ name: 'get_balances', arguments: {} })) as ToolResult;
    const afterItems = after.structuredContent?.items as { name: string; balance: string }[];
    expect(afterItems.find((a) => a.name === usd)?.balance).toBe('140.00000000');
  });

  it('returns business errors as isError with per-item keys', async () => {
    const mcp = await connect(assistantToken);
    const bad = (await mcp.callTool({
      name: 'add_transactions',
      arguments: {
        idempotencyKey: `bad-${tag}`,
        transactions: [
          {
            externalRef: `mcp:${tag}:2`,
            occurredOn: '2046-01-06',
            type: 'expense',
            category: 'Bank Fees',
            from: { account: 'Missing', amount: '1' },
          },
        ],
      },
    })) as ToolResult;
    expect(bad.isError).toBe(true);
    expect(JSON.stringify(bad.structuredContent)).toContain('transactions.0');
    // Agents get English text, not message keys (A-058).
    expect(JSON.stringify(bad.structuredContent)).toContain('from: account “Missing” not found');
  });

  it('people and clients: written by name, read back without payee details', async () => {
    const mcp = await connect(assistantToken);
    const fullName = `M ${tag} Olena`;
    await mcp.callTool({
      name: 'upsert_person_profile',
      arguments: {
        idempotencyKey: `people-${tag}`,
        people: [{ fullName, stack: ['Go'], marketRateUsd: '40' }],
      },
    });
    const found = (await mcp.callTool({
      name: 'search_people',
      arguments: { q: fullName },
    })) as ToolResult;
    const people = found.structuredContent?.items as Record<string, unknown>[];
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ fullName, stack: ['Go'], bench: 'free' });
    expect(people[0]).not.toHaveProperty('defaultPayeeId');

    const card = (await mcp.callTool({
      name: 'get_person',
      arguments: { id: people[0]?.id },
    })) as ToolResult;
    expect(card.structuredContent).toMatchObject({ defaultPayee: null });

    const address = `0x${tag}${'ab'.repeat(16)}`;
    const wallet = (await mcp.callTool({
      name: 'upsert_wallets',
      arguments: {
        idempotencyKey: `wallets-${tag}`,
        wallets: [
          {
            personId: people[0]?.id,
            network: 'ETH',
            address: address.toUpperCase().replace('0X', '0x'),
          },
        ],
      },
    })) as ToolResult;
    expect(wallet.structuredContent).toMatchObject({ wallets: [{ status: 'created' }] });
    const withWallet = (await mcp.callTool({
      name: 'get_person',
      arguments: { id: people[0]?.id },
    })) as ToolResult;
    expect(withWallet.structuredContent?.wallets).toEqual([
      expect.objectContaining({ network: 'ETH', address, isActive: true }),
    ]);
    const owner = (await mcp.callTool({
      name: 'find_wallets',
      arguments: { address },
    })) as ToolResult;
    expect(owner.structuredContent).toMatchObject({
      wallets: [{ owner: { kind: 'person', name: fullName } }],
      ownAccounts: [],
    });

    const taxId = String(Date.now()).slice(-10);
    const payee = (await mcp.callTool({
      name: 'upsert_payees',
      arguments: {
        idempotencyKey: `payees-${tag}`,
        payees: [
          {
            legalNameUa: `ФОП M ${tag}`,
            taxId,
            iban: 'UA21 3223 1300 0002 6007 2335 6600 1',
            personId: people[0]?.id,
            makeDefault: true,
          },
        ],
      },
    })) as ToolResult;
    expect(payee.structuredContent).toMatchObject({ payees: [{ status: 'created' }] });
    const linked = (await mcp.callTool({
      name: 'get_person',
      arguments: { id: people[0]?.id },
    })) as ToolResult;
    expect(linked.structuredContent).toMatchObject({ defaultPayee: { name: `ФОП M ${tag}` } });

    const legalName = `M ${tag} Client Ltd`;
    const saved = (await mcp.callTool({
      name: 'upsert_clients',
      arguments: { idempotencyKey: `clients-${tag}`, clients: [{ legalName, country: 'UK' }] },
    })) as ToolResult;
    expect(saved.structuredContent).toMatchObject({ clients: [{ legalName, status: 'created' }] });
  });

  it('a revoked client gets 403 with a still valid token', async () => {
    await revokeMcpClient.run(h.ctxFor(owner), { clientId: clientIds[1] });
    const response = await rpc(readOnlyToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.status).toBe(403);
  });
});
