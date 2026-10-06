import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  account,
  assignment,
  auditLog,
  client,
  company,
  contract,
  contractAnnex,
  document,
  documentLink,
  invoice,
  mcpCallLog,
  mcpClientPolicy,
  payee,
  person,
  plannedExpense,
  transaction,
} from '@tally/db/schema';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../test/int-helpers';
import { createMcpClient, revokeMcpClient } from '../services/mcp';
import { LocalStorage } from '../storage/local-storage';
import { handleMcpRequest, type McpHttpDeps } from './http';
import { createMcpServer, type McpStore } from './server';
import * as store from './store';

const h = intHarness('2046-02-10');
const tag = randomUUID().slice(0, 8);
const usd = `M ${tag} USD`;
let owner: Awaited<ReturnType<typeof h.user>>;
let assistantToken = '';
let readOnlyToken = '';
// Write calls are rate-limited per client; the contract tests run on a client of their own.
let contractsToken = '';
let packagesToken = '';
let plannedToken = '';
const clientIds: string[] = [];
let storageRoot = '';
let storage: LocalStorage;

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
  storage: () => storage,
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
  storageRoot = await mkdtemp(join(tmpdir(), 'tally-mcp-'));
  storage = new LocalStorage(storageRoot);
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
  const contracts = (
    await createMcpClient.run(ctx, { clientName: `int ${tag} contracts`, profile: 'assistant' })
  )._unsafeUnwrap();
  contractsToken = contracts.token;
  const packages = (
    await createMcpClient.run(ctx, { clientName: `int ${tag} packages`, profile: 'assistant' })
  )._unsafeUnwrap();
  packagesToken = packages.token;
  clientIds.push(packages.clientId);
  clientIds.push(contracts.clientId);
  const planned = (
    await createMcpClient.run(ctx, { clientName: `int ${tag} planned`, profile: 'assistant' })
  )._unsafeUnwrap();
  plannedToken = planned.token;
  clientIds.push(planned.clientId);
});

afterAll(() =>
  h.cleanup(async (db) => {
    await rm(storageRoot, { recursive: true, force: true });
    await db
      .update(document)
      .set({ supersedesId: null })
      .where(like(document.title, `M ${tag}%`));
    await db.delete(document).where(like(document.title, `M ${tag}%`));
    await db.delete(invoice).where(eq(invoice.dateOverrideReason, `M ${tag}`));
    const testContracts = await db
      .select({ id: contract.id })
      .from(contract)
      .where(like(contract.number, `M ${tag}%`));
    if (testContracts.length) {
      await db.delete(assignment).where(
        inArray(
          assignment.contractId,
          testContracts.map((c) => c.id),
        ),
      );
      await db.delete(contractAnnex).where(
        inArray(
          contractAnnex.contractId,
          testContracts.map((c) => c.id),
        ),
      );
    }
    await db.delete(contract).where(like(contract.number, `M ${tag}%`));
    await db.delete(company).where(like(company.nameEn, `M ${tag}%`));
    // Unlinked first: a paid planned payment cannot be deleted (TL064).
    const plannedTx = await db.execute<{ id: string }>(sql`
      select a.transaction_id as id from public.allocation a
        join public.planned_payment pp on pp.id = a.planned_payment_id
        join public.planned_expense pe on pe.id = pp.planned_expense_id
       where pe.name like ${`M ${tag}%`}
    `);
    await db.execute(sql`
      delete from public.allocation where planned_payment_id in (
        select pp.id from public.planned_payment pp
          join public.planned_expense pe on pe.id = pp.planned_expense_id
         where pe.name like ${`M ${tag}%`})
    `);
    const plannedTxIds = [...plannedTx].map((r) => r.id);
    if (plannedTxIds.length) {
      await db.delete(transaction).where(inArray(transaction.id, plannedTxIds));
    }
    await db.execute(sql`
      delete from public.planned_payment where parent_id is not null and planned_expense_id in
        (select id from public.planned_expense where name like ${`M ${tag}%`})
    `);
    await db.execute(sql`
      delete from public.planned_payment where planned_expense_id in
        (select id from public.planned_expense where name like ${`M ${tag}%`})
    `);
    await db.delete(plannedExpense).where(like(plannedExpense.name, `M ${tag}%`));
    await db.execute(sql`
      delete from public.payment_charge where person_id in
        (select id from public.person where full_name like ${`M ${tag}%`})
    `);
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
      'list_invoices',
      'get_invoice',
      'get_balances',
      'list_categories',
      'list_transactions',
      'list_fx_rates',
      'search_people',
      'get_person',
      'list_clients',
      'list_contracts',
      'get_contract',
      'list_contract_annexes',
      'list_assignments',
      'find_wallets',
      'list_payees',
      'list_trips',
      'get_trip',
      'search_documents',
      'get_document',
      'find_link_targets',
      'list_planned_expenses',
      'list_payout_charges',
      'list_planned_payments',
      'get_payroll_queue',
    ]);
  });

  it('lists only the tools of the profile; write tools require an idempotency key', async () => {
    const mcp = await connect(assistantToken);
    const { tools } = await mcp.listTools();
    expect(tools).toHaveLength(50);
    for (const name of ['delete_transactions', 'unlink_documents', 'delete_documents']) {
      const del = tools.find((t) => t.name === name);
      expect(del?.annotations).toMatchObject({ destructiveHint: true });
    }
    const reconcile = tools.find((t) => t.name === 'reconcile_invoice_numbers');
    expect(reconcile?.inputSchema.required).toContain('idempotencyKey');
    expect(reconcile?.annotations).toMatchObject({ destructiveHint: false, idempotentHint: true });
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

    const preview = (await mcp.callTool({
      name: 'delete_transactions',
      arguments: { idempotencyKey: `delete-dry-${tag}`, ids: [row?.id], dryRun: true },
    })) as ToolResult;
    expect(preview.structuredContent).toMatchObject({ deleted: 1 });
    const missing = (await mcp.callTool({
      name: 'delete_transactions',
      arguments: { idempotencyKey: `delete-bad-${tag}`, ids: [row?.id, crypto.randomUUID()] },
    })) as ToolResult;
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.structuredContent)).toContain('ids.1');
    const deleted = (await mcp.callTool({
      name: 'delete_transactions',
      arguments: { idempotencyKey: `delete-${tag}`, ids: [row?.id] },
    })) as ToolResult;
    expect(deleted.structuredContent).toMatchObject({ deleted: 1 });
    const final = (await mcp.callTool({ name: 'get_balances', arguments: {} })) as ToolResult;
    const finalItems = final.structuredContent?.items as { name: string; balance: string }[];
    expect(finalItems.find((a) => a.name === usd)?.balance).toBe('100.00000000');
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

  it('documents: add with a file, read it back, version it, link and unlink (A-071)', async () => {
    const mcp = await connect(assistantToken);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await mcp.callTool({ name, arguments: args })) as ToolResult;
    const [p] = await h.db
      .insert(person)
      .values({ fullName: `M ${tag} Docs` })
      .returning();
    const [c] = await h.db
      .insert(client)
      .values({ legalName: `M ${tag} Docs Ltd` })
      .returning();
    const personId = p?.id ?? '';
    const pdf = Buffer.from('%PDF-1.7 nda').toString('base64');
    const item = {
      type: 'nda',
      title: `M ${tag} NDA`,
      docDate: '2046-02-01',
      file: { fileName: 'nda.pdf', mimeType: 'application/pdf', contentBase64: pdf },
      links: [{ entityType: 'person', entityId: personId }],
    };

    const preview = await call('add_documents', {
      idempotencyKey: `docs-dry-${tag}`,
      dryRun: true,
      documents: [item],
    });
    expect(preview.structuredContent).toMatchObject({
      results: [{ status: 'preview', id: null, version: 1, links: [{ label: `M ${tag} Docs` }] }],
    });
    expect((preview.structuredContent?.results as { folderPath: string }[])[0]?.folderPath).toMatch(
      /^people\//,
    );
    expect(await readdir(storageRoot)).toEqual([]);

    const missing = await call('add_documents', {
      idempotencyKey: `docs-missing-${tag}`,
      documents: [{ ...item, links: [{ entityType: 'client', entityId: randomUUID() }] }],
    });
    expect(missing.isError).toBe(true);
    expect(JSON.stringify(missing.structuredContent)).toContain('documents.0');

    const tooBig = await call('add_documents', {
      idempotencyKey: `docs-big-${tag}`,
      documents: [
        {
          ...item,
          file: {
            ...item.file,
            contentBase64: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64'),
          },
        },
      ],
    });
    expect(tooBig.isError).toBe(true);

    const added = await call('add_documents', { idempotencyKey: `docs-${tag}`, documents: [item] });
    const docId = (added.structuredContent?.results as { id: string }[])[0]?.id ?? '';
    expect(docId).toMatch(/[0-9a-f-]{36}/);

    const found = await call('search_documents', {
      linkedTo: { entityType: 'person', entityId: personId },
    });
    expect(found.structuredContent?.items).toEqual([
      expect.objectContaining({
        id: docId,
        hasFile: true,
        links: [expect.objectContaining({ label: `M ${tag} Docs` })],
      }),
    ]);
    const card = await call('get_document', { id: docId, includeContent: true });
    expect(card.structuredContent).toMatchObject({
      fileName: 'nda.pdf',
      isLatestVersion: true,
      content: { contentBase64: pdf, mimeType: 'application/pdf' },
    });

    const v2 = await call('add_documents', {
      idempotencyKey: `docs-v2-${tag}`,
      documents: [{ ...item, title: `M ${tag} NDA v2`, supersedesId: docId }],
    });
    expect(v2.structuredContent).toMatchObject({ results: [{ version: 2 }] });
    const old = await call('get_document', { id: docId });
    expect(old.structuredContent).toMatchObject({ isLatestVersion: false });
    expect(old.structuredContent?.versions).toHaveLength(2);

    const targets = await call('find_link_targets', { entityType: 'client', q: `M ${tag} Docs` });
    expect(targets.structuredContent?.items).toEqual([{ id: c?.id, label: `M ${tag} Docs Ltd` }]);
    const link = { documentId: docId, entityType: 'client', entityId: c?.id };
    const linked = await call('link_documents', {
      idempotencyKey: `link-${tag}`,
      links: [link, link],
    });
    expect(linked.structuredContent).toMatchObject({
      results: [{ status: 'linked', label: `M ${tag} Docs Ltd` }, { status: 'existing' }],
    });
    const unlinked = await call('unlink_documents', {
      idempotencyKey: `unlink-${tag}`,
      links: [link, link],
    });
    expect(unlinked.structuredContent).toMatchObject({
      results: [{ status: 'unlinked' }, { status: 'missing' }],
    });

    const renamed = await call('update_documents', {
      idempotencyKey: `docs-upd-${tag}`,
      documents: [{ id: docId, title: `M ${tag} NDA (old)`, status: 'void' }],
    });
    expect(renamed.isError).toBeFalsy();
    const [generated] = await h.db
      .insert(document)
      .values({
        type: 'invoice',
        title: `M ${tag} generated`,
        url: 'https://x.test/a',
        sourceRevision: 1,
      })
      .returning();
    const locked = await call('update_documents', {
      idempotencyKey: `docs-locked-${tag}`,
      documents: [{ id: generated?.id, title: 'x' }],
    });
    expect(JSON.stringify(locked.structuredContent)).toContain('generated this document');
  });

  it('documents: delete keeps version chains, trashes files, refuses Tally files (A-072)', async () => {
    const mcp = await connect(assistantToken);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await mcp.callTool({ name, arguments: args })) as ToolResult;
    const [c] = await h.db
      .insert(client)
      .values({ legalName: `M ${tag} Del Ltd` })
      .returning();
    const file = (name: string) => ({
      fileName: `${name}.pdf`,
      mimeType: 'application/pdf',
      contentBase64: Buffer.from(`%PDF ${name}`).toString('base64'),
    });
    const add = async (title: string, supersedesId?: string) => {
      const res = await call('add_documents', {
        idempotencyKey: `del-add-${title}-${tag}`,
        documents: [
          {
            type: 'other',
            title: `M ${tag} ${title}`,
            file: file(title),
            links: [{ entityType: 'client', entityId: c?.id }],
            ...(supersedesId ? { supersedesId } : {}),
          },
        ],
      });
      return (res.structuredContent?.results as { id: string }[])[0]?.id ?? '';
    };
    const v1 = await add('cert-v1');
    const v2 = await add('cert-v2', v1);
    const v3 = await add('cert-v3', v2);
    const files = async () => (await readdir(storageRoot, { recursive: true })).length;
    const before = await files();

    const preview = await call('delete_documents', {
      idempotencyKey: `del-dry-${tag}`,
      dryRun: true,
      ids: [v2],
    });
    expect(preview.structuredContent).toMatchObject({
      results: [{ id: v2, status: 'would_delete', links: 1, file: 'trash' }],
    });
    expect(await files()).toBe(before);

    const deleted = await call('delete_documents', { idempotencyKey: `del-${tag}`, ids: [v2] });
    expect(deleted.structuredContent).toMatchObject({
      results: [{ id: v2, status: 'deleted', file: 'trash' }],
    });
    expect(await files()).toBeLessThan(before);
    const [newest] = await h.db.select().from(document).where(eq(document.id, v3));
    expect(newest?.supersedesId).toBe(v1);
    expect(await h.db.select().from(documentLink).where(eq(documentLink.documentId, v2))).toEqual(
      [],
    );

    const [co] = await h.db
      .insert(company)
      .values({ nameEn: `M ${tag} Co`, nameUa: 'К' })
      .returning();
    const [ct] = await h.db
      .insert(contract)
      .values({ kind: 'client', number: `M ${tag} MSA`, companyId: co?.id ?? '', clientId: c?.id })
      .returning();
    const [inv] = await h.db
      .insert(invoice)
      .values({
        clientId: c?.id ?? '',
        contractId: ct?.id ?? '',
        issueDate: '2046-02-02',
        dueDate: '2046-02-20',
        dateOverrideReason: `M ${tag}`,
      })
      .returning();
    const [pdf] = await h.db
      .insert(document)
      .values({ type: 'invoice', title: `M ${tag} invoice pdf`, url: 'https://x.test/i' })
      .returning();
    await h.db
      .insert(documentLink)
      .values({ documentId: pdf?.id ?? '', entityType: 'invoice', entityId: inv?.id ?? '' });
    const refused = await call('delete_documents', {
      idempotencyKey: `del-locked-${tag}`,
      ids: [v1, pdf?.id, randomUUID()],
    });
    expect(refused.isError).toBe(true);
    const text = JSON.stringify(refused.structuredContent);
    expect(text).toContain('ids.1');
    expect(text).toContain('ids.2');
    expect(text).not.toContain('ids.0');
    expect(await h.db.select().from(document).where(eq(document.id, v1))).toHaveLength(1);
  });

  it('documents: a signed package is split into parts that point back to it (A-078)', async () => {
    const mcp = await connect(packagesToken);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await mcp.callTool({ name, arguments: args })) as ToolResult;
    const [c] = await h.db
      .insert(client)
      .values({ legalName: `M ${tag} Pack Ltd` })
      .returning();
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 5; i++) pdf.addPage();
    const added = await call('add_documents', {
      idempotencyKey: `pack-add-${tag}`,
      documents: [
        {
          type: 'contract',
          title: `M ${tag} MSA + SOW 1`,
          docDate: '2046-01-15',
          file: {
            fileName: 'msa.pdf',
            mimeType: 'application/pdf',
            contentBase64: Buffer.from(await pdf.save()).toString('base64'),
          },
          links: [{ entityType: 'client', entityId: c?.id }],
        },
      ],
    });
    const packageId = (added.structuredContent?.results as { id: string }[])[0]?.id ?? '';
    const parts = [
      { type: 'contract', title: `M ${tag} MSA`, number: 'MSA-1', pages: '1-3' },
      { type: 'sow', title: `M ${tag} SOW 1`, number: '1', pages: '4-5' },
    ];

    const outOfRange = await call('split_document', {
      idempotencyKey: `pack-bad-${tag}`,
      id: packageId,
      parts: [{ type: 'sow', title: `M ${tag} bad`, pages: '4-6' }],
    });
    expect(JSON.stringify(outOfRange.structuredContent)).toContain('1–5');

    const preview = await call('split_document', {
      idempotencyKey: `pack-dry-${tag}`,
      id: packageId,
      parts,
      dryRun: true,
    });
    expect(preview.structuredContent).toMatchObject({
      package: { id: packageId, pageCount: 5, wasType: 'contract' },
      parts: [
        { status: 'preview', pages: '1-3' },
        { status: 'preview', pages: '4-5' },
      ],
    });
    const split = await call('split_document', {
      idempotencyKey: `pack-${tag}`,
      id: packageId,
      parts,
    });
    expect(split.isError).toBeFalsy();
    const created = (split.structuredContent?.parts as { id: string }[]).map((p) => p.id);

    const pkg = await call('get_document', { id: packageId });
    expect(pkg.structuredContent).toMatchObject({
      type: 'package',
      parts: expect.arrayContaining([
        expect.objectContaining({ id: created[0], pages: '1-3' }),
        expect.objectContaining({ id: created[1], type: 'sow', pages: '4-5' }),
      ]),
    });
    expect(pkg.structuredContent?.parts).toHaveLength(2);
    const sow = await call('get_document', { id: created[1], includeContent: true });
    expect(sow.structuredContent).toMatchObject({
      docDate: '2046-01-15',
      package: { id: packageId, pages: '4-5' },
      links: [{ entityType: 'client', entityId: c?.id }],
    });
    const copy = await PDFDocument.load(
      Buffer.from(
        (sow.structuredContent?.content as { contentBase64: string }).contentBase64,
        'base64',
      ),
    );
    expect(copy.getPageCount()).toBe(2);

    const retyped = await call('update_documents', {
      idempotencyKey: `pack-type-${tag}`,
      documents: [{ id: packageId, type: 'contract' }],
    });
    expect(retyped.isError).toBe(true);
    const bill = await call('update_documents', {
      idempotencyKey: `pack-bill-${tag}`,
      documents: [{ id: created[0], type: 'bill' }],
    });
    expect(bill.isError).toBeFalsy();
  });

  it('contracts and SOWs: created with rules, documents linked without re-upload (A-072)', async () => {
    const mcp = await connect(contractsToken);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await mcp.callTool({ name, arguments: args })) as ToolResult;
    const [c] = await h.db
      .insert(client)
      .values({ legalName: `M ${tag} IdeaSoft` })
      .returning();
    const clientId = c?.id ?? '';
    const added = await call('add_documents', {
      idempotencyKey: `ct-docs-${tag}`,
      documents: [
        { type: 'contract', title: `M ${tag} MSA pdf`, url: 'https://x.test/msa' },
        { type: 'sow', title: `M ${tag} SOW pdf`, url: 'https://x.test/sow' },
      ],
    });
    const [msaDoc, sowDoc] = (added.structuredContent?.results as { id: string }[]).map(
      (r) => r.id,
    );
    const item = {
      kind: 'client',
      number: `M ${tag} MSA-1`,
      clientId,
      signedOn: '2046-01-15',
      paymentDueRule: { type: 'net_working_days', days: 15 },
      documentIds: [msaDoc],
    };

    const invalid = await call('upsert_contracts', {
      idempotencyKey: `ct-bad-${tag}`,
      contracts: [{ ...item, clientId: undefined }],
    });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.structuredContent)).toContain('contracts.0');

    const dry = await call('upsert_contracts', {
      idempotencyKey: `ct-dry-${tag}`,
      dryRun: true,
      contracts: [item],
    });
    expect(dry.structuredContent).toMatchObject({ results: [{ status: 'created' }] });
    expect(await h.db.select().from(contract).where(eq(contract.clientId, clientId))).toEqual([]);

    const created = await call('upsert_contracts', {
      idempotencyKey: `ct-${tag}`,
      contracts: [item],
    });
    expect(created.structuredContent).toMatchObject({
      results: [{ status: 'created', linkedDocuments: 1 }],
    });
    const contractId = (created.structuredContent?.results as { id: string }[])[0]?.id ?? '';
    const again = await call('upsert_contracts', {
      idempotencyKey: `ct-again-${tag}`,
      contracts: [{ number: item.number.toLowerCase(), clientId, status: 'active' }],
    });
    expect(again.structuredContent).toMatchObject({
      results: [{ id: contractId, status: 'updated', linkedDocuments: 0 }],
    });

    const sow = await call('upsert_contract_annexes', {
      idempotencyKey: `sow-${tag}`,
      annexes: [
        {
          contractId,
          kind: 'sow',
          number: '1',
          title: 'Trading terminal',
          validFrom: '2046-02-01',
          invoiceDateRule: { type: 'nth_working_day_after_period', n: 3 },
          documentIds: [sowDoc],
        },
      ],
    });
    expect(sow.isError).toBeFalsy();
    const sowId = (sow.structuredContent?.results as { id: string }[])[0]?.id ?? '';
    const backwards = await call('upsert_contract_annexes', {
      idempotencyKey: `sow-bad-${tag}`,
      annexes: [{ id: sowId, validTo: '2046-01-01' }],
    });
    expect(backwards.isError).toBe(true);

    const targets = await call('find_link_targets', { entityType: 'contract_annex', q: 'Trading' });
    expect(targets.structuredContent?.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: sowId })]),
    );

    const card = await call('get_contract', { id: contractId });
    expect(card.structuredContent).toMatchObject({
      number: item.number,
      clientName: `M ${tag} IdeaSoft`,
      paymentDueRule: { type: 'net_working_days', days: 15 },
      documents: [{ id: msaDoc }],
      annexes: [
        {
          id: sowId,
          kind: 'sow',
          paymentDueRule: null,
          invoiceDateRule: { type: 'nth_working_day_after_period', n: 3 },
          documents: [{ id: sowDoc }],
        },
      ],
      assignments: [],
    });
    const listed = await call('list_contracts', { clientId });
    expect(listed.structuredContent?.items).toMatchObject([{ id: contractId, annexes: 1 }]);
    const annexes = await call('list_contract_annexes', { contractId });
    expect(annexes.structuredContent?.items).toMatchObject([{ id: sowId, number: '1' }]);
  });

  it('assignments: created on a SOW with terms, versions added but never edited (A-073)', async () => {
    const mcp = await connect(contractsToken);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await mcp.callTool({ name, arguments: args })) as ToolResult;
    const [p] = await h.db
      .insert(person)
      .values({ fullName: `M ${tag} Andrii` })
      .returning();
    const [c] = await h.db
      .insert(client)
      .values({ legalName: `M ${tag} Boosty` })
      .returning();
    const [co] = await h.db
      .insert(company)
      .values({ nameEn: `M ${tag} Co2`, nameUa: 'К' })
      .returning();
    const [ct, other] = await h.db
      .insert(contract)
      .values(
        [`M ${tag} SOW-MSA`, `M ${tag} Other`].map((number) => ({
          kind: 'client',
          number,
          companyId: co?.id ?? '',
          clientId: c?.id ?? '',
        })),
      )
      .returning();
    const [sow, foreign] = await h.db
      .insert(contractAnnex)
      .values([
        { contractId: ct?.id ?? '', kind: 'sow', number: '3' },
        { contractId: other?.id ?? '', kind: 'sow', number: '1' },
      ])
      .returning();
    const item = {
      personId: p?.id,
      contractId: ct?.id,
      annexId: sow?.id,
      roleTitle: 'Backend',
      fte: '0.5',
      startsOn: '2046-01-05',
      billing: { type: 'hourly', rate: '47' },
      pay: { type: 'hourly', amount: '3000' },
    };

    const dry = await call('upsert_assignments', {
      idempotencyKey: `as-dry-${tag}`,
      dryRun: true,
      assignments: [item],
    });
    expect(dry.structuredContent).toMatchObject({ results: [{ status: 'created' }] });
    expect(
      await h.db
        .select()
        .from(assignment)
        .where(eq(assignment.contractId, ct?.id ?? '')),
    ).toEqual([]);

    const created = await call('upsert_assignments', {
      idempotencyKey: `as-${tag}`,
      assignments: [item],
    });
    expect(created.structuredContent).toMatchObject({
      results: [{ status: 'created', billingVersion: 'added', payVersion: 'added' }],
    });
    const id = (created.structuredContent?.results as { id: string }[])[0]?.id ?? '';

    const again = await call('upsert_assignments', {
      idempotencyKey: `as-again-${tag}`,
      assignments: [{ ...item, billing: { ...item.billing, rate: '47.00', validFrom: '2046-01' } }],
    });
    expect(again.structuredContent).toMatchObject({
      results: [{ id, status: 'unchanged', billingVersion: 'existing', payVersion: 'existing' }],
    });

    const edited = await call('upsert_assignments', {
      idempotencyKey: `as-edit-${tag}`,
      assignments: [{ id, billing: { type: 'hourly', rate: '50', validFrom: '2046-01-01' } }],
    });
    expect(edited.isError).toBe(true);
    expect(JSON.stringify(edited.structuredContent)).toContain(
      'a version from 2046-01-01 already exists',
    );

    const wrongSow = await call('upsert_assignments', {
      idempotencyKey: `as-sow-${tag}`,
      assignments: [{ id, annexId: foreign?.id }],
    });
    expect(JSON.stringify(wrongSow.structuredContent)).toContain('belongs to another contract');

    const raised = await call('upsert_assignments', {
      idempotencyKey: `as-raise-${tag}`,
      assignments: [
        { id, endsOn: '2046-12-31', billing: { type: 'hourly', rate: '50', validFrom: '2046-03' } },
      ],
    });
    expect(raised.structuredContent).toMatchObject({
      results: [{ status: 'updated', billingVersion: 'added' }],
    });

    const listed = await call('list_assignments', { contractId: ct?.id, activeOn: '2046-03-15' });
    expect(listed.structuredContent?.items).toMatchObject([
      {
        id,
        personName: `M ${tag} Andrii`,
        annexId: sow?.id,
        annex: 'SOW 3',
        fte: '0.50',
        endsOn: '2046-12-31',
        billing: { validFrom: '2046-03-01', rate: '50.00000000' },
        pay: { type: 'hourly', amount: '3000.00000000' },
        billingVersions: [{ validFrom: '2046-01-01' }, { validFrom: '2046-03-01' }],
      },
    ]);
    const card = await call('get_contract', { id: ct?.id });
    expect(card.structuredContent).toMatchObject({ assignments: [{ id, annexId: sow?.id }] });
  });

  it('planned payments: a salary with taxes set up, listed, skipped and paid (A-082)', async () => {
    const mcp = await connect(plannedToken);
    const call = async (name: string, args: Record<string, unknown>) =>
      (await mcp.callTool({ name, arguments: args })) as ToolResult;
    const cats = await h.db.execute<{ id: string; name: string }>(
      sql`select id, name from public.category where tx_type = 'expense' and name in ('Payroll', 'Taxes')`,
    );
    const cat = (n: string) => [...cats].find((c) => c.name === n)?.id;
    const [acc] = await h.db
      .insert(account)
      .values({ name: `M ${tag} UAH`, kind: 'bank', currency: 'UAH', openingDate: '2046-01-01' })
      .returning();
    const [abroad] = await h.db
      .insert(person)
      .values({ fullName: `M ${tag} Abroad` })
      .returning();
    const tax = (name: string, mode: string, ratePercent: string) => ({
      name,
      mode,
      ratePercent,
      categoryId: cat('Taxes'),
      startsOn: '2046-02',
      feeFixed: '5',
    });
    const plan = {
      name: `M ${tag} Director salary`,
      categoryId: cat('Payroll'),
      amount: '11401.68',
      currency: 'UAH',
      startsOn: '2046-02',
      parts: [
        { name: 'Advance', amount: '5500', dueDay: 22 },
        { name: 'Rest', amount: null, dueDay: 7, monthOffset: 1 },
      ],
      charges: [
        tax('PIT', 'withheld', '18'),
        tax('Levy', 'withheld', '5'),
        tax('ESV', 'on_top', '22'),
      ],
    };
    const dry = await call('upsert_planned_expenses', {
      idempotencyKey: `pl-dry-${tag}`,
      dryRun: true,
      items: [plan],
    });
    expect(dry.isError).toBeFalsy();
    expect(
      await h.db
        .select()
        .from(plannedExpense)
        .where(like(plannedExpense.name, `M ${tag}%`)),
    ).toHaveLength(0);
    const saved = await call('upsert_planned_expenses', {
      idempotencyKey: `pl-save-${tag}`,
      items: [plan],
    });
    expect(saved.structuredContent).toMatchObject({ items: [{ status: 'created' }] });

    const listed = await call('list_planned_payments', { from: '2046-02-01', to: '2046-03-31' });
    const items = listed.structuredContent?.items as {
      id: string;
      name: string;
      dueOn: string;
      amount: string;
      parentId: string | null;
      status: string;
    }[];
    const advance = items.find((i) => i.name === 'Advance' && i.dueOn === '2046-02-22');
    expect(advance?.amount).toBe('4235.00000000');
    expect(items.filter((i) => i.parentId === advance?.id)).toHaveLength(3);
    const rest = items.find((i) => i.name === 'Rest' && i.dueOn === '2046-03-07');

    const done = await call('update_planned_payments', {
      idempotencyKey: `pl-upd-${tag}`,
      payments: [
        { id: advance?.id, action: 'pay', accountId: acc?.id, occurredOn: '2046-02-20' },
        { id: rest?.id, action: 'set_amount', amount: '6000' },
      ],
    });
    expect(done.isError).toBeFalsy();
    const bad = await call('update_planned_payments', {
      idempotencyKey: `pl-bad-${tag}`,
      payments: [{ id: advance?.id, action: 'skip', reason: 'Too late' }],
    });
    expect(bad.isError).toBe(true);
    const after = await call('list_planned_payments', { from: '2046-02-01', to: '2046-03-31' });
    const rows = after.structuredContent?.items as typeof items;
    expect(rows.find((i) => i.id === advance?.id)?.status).toBe('paid');
    expect(rows.find((i) => i.id === rest?.id)?.amount).toBe('4620.00000000');

    const charge = await call('upsert_payout_charges', {
      idempotencyKey: `pl-ch-${tag}`,
      charges: [{ ...tax('Tax 20 %', 'on_top', '20'), personId: abroad?.id, currency: 'UAH' }],
    });
    expect(charge.isError).toBeFalsy();
    const queue = await call('get_payroll_queue', {});
    expect(Array.isArray(queue.structuredContent?.items)).toBe(true);
    const merge = await call('merge_payout_acts', {
      idempotencyKey: `pl-merge-${tag}`,
      dryRun: true,
      firstId: randomUUID(),
      secondId: randomUUID(),
    });
    expect(merge.isError).toBe(true);
    const charges = await call('list_payout_charges', { personIds: [abroad?.id] });
    expect(charges.structuredContent?.items).toMatchObject([
      { name: 'Tax 20 %', mode: 'on_top', ratePercent: '20.0000', currency: 'UAH' },
    ]);
  });

  it('a revoked client gets 403 with a still valid token', async () => {
    await revokeMcpClient.run(h.ctxFor(owner), { clientId: clientIds[1] });
    const response = await rpc(readOnlyToken, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(response.status).toBe(403);
  });
});
