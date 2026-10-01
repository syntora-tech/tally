import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import type { Db } from '@tally/db';
import type { LocalDate } from '@tally/domain';
import { z } from 'zod';
import type { ServiceConfig, ServiceContext } from '../services/context';
import type { ServiceError } from '../services/errors';
import type { McpClient } from './store';
import { RATE_LIMITS, toolsFor, type ToolDef } from './tools';

/** Side effects of a call that live outside the caller's RLS scope (see store.ts). */
export type McpStore = {
  recentCalls: (clientId: string, tools: readonly string[]) => Promise<number>;
  logCall: (entry: {
    clientId: string;
    userId: string;
    tool: string;
    argsHash: string;
    outcome: string;
    durationMs: number;
  }) => Promise<void>;
  findIdempotent: (clientId: string, key: string) => Promise<{ response: unknown } | null>;
  saveIdempotent: (entry: {
    clientId: string;
    key: string;
    tool: string;
    response: unknown;
  }) => Promise<void>;
};

export type McpSession = {
  client: McpClient;
  db: Db;
  today: LocalDate;
  config: ServiceConfig;
  store: McpStore;
};

const idempotencyKey = z.string().trim().min(8).max(200);

function inputSchema(tool: ToolDef) {
  const schema = z.toJSONSchema(tool.input, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  delete (schema as { $schema?: string }).$schema;
  if (tool.kind === 'write') {
    schema.properties = {
      ...schema.properties,
      idempotencyKey: {
        type: 'string',
        minLength: 8,
        maxLength: 200,
        description:
          'Required. A unique key per logical write; repeating it within 7 days returns the first result instead of writing again',
      },
    };
    schema.required = [...(schema.required ?? []), 'idempotencyKey'];
  }
  return { type: 'object' as const, ...schema };
}

const result = (value: unknown, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: Array.isArray(value) ? { items: value } : (value as Record<string, unknown>),
  ...(isError ? { isError: true } : {}),
});

const failure = (error: ServiceError | { code: string; message: string; retryAfter?: number }) =>
  result({ error }, true);

/**
 * Stateless MCP server bound to one authenticated client (spec 13.1): `tools/list` shows only the
 * profile's tools, and every call runs the service as the token's user with `via = mcp`, so RLS
 * and audit behave as in the UI.
 */
export function createMcpServer(session: McpSession): McpServer {
  const { client, store } = session;
  const tools = toolsFor(client.profile, client.allowedTools);
  const mcp = new McpServer(
    { name: 'tally', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Tally back-office of Syntora.Tech. Money amounts are decimal strings, dates are YYYY-MM-DD. Read before writing; run write tools with dryRun: true first, then repeat without it using a new idempotencyKey.',
    },
  );

  // Tools are served by hand so their input schemas are the services' own Zod schemas,
  // converted once with the transform-tolerant settings (13.4 rule 1).
  const server = mcp.server;
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: inputSchema(t),
      annotations:
        t.kind === 'read'
          ? { readOnlyHint: true, openWorldHint: false }
          : {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const started = Date.now();
    const name = request.params.name;
    const args = { ...request.params.arguments };
    const tool = tools.find((t) => t.name === name);
    if (!tool) {
      return failure({ code: 'not_found', message: `Unknown or not allowed tool: ${name}` });
    }

    const sameKind = tools.filter((t) => t.kind === tool.kind).map((t) => t.name);
    if ((await store.recentCalls(client.clientId, sameKind)) >= RATE_LIMITS[tool.kind]) {
      return failure({
        code: 'rate_limited',
        message: `Limit of ${String(RATE_LIMITS[tool.kind])} ${tool.kind} calls per minute reached`,
        retryAfter: 60,
      });
    }

    let key: string | null = null;
    if (tool.kind === 'write') {
      const parsedKey = idempotencyKey.safeParse(args.idempotencyKey);
      if (!parsedKey.success) {
        return failure({
          code: 'validation_error',
          message: 'idempotencyKey is required: a unique string of 8–200 characters per write',
        });
      }
      key = parsedKey.data;
      delete args.idempotencyKey;
      const previous = await store.findIdempotent(client.clientId, key);
      if (previous) return result(previous.response);
    }

    const ctx: ServiceContext = {
      actor: {
        kind: 'user',
        userId: client.user.id,
        email: client.user.email,
        role: client.user.role,
        claims: { sub: client.user.id, role: 'authenticated', email: client.user.email },
        via: 'mcp',
        clientId: client.clientId,
      },
      today: session.today,
      db: session.db,
      config: session.config,
    };

    const outcome = await tool.run(ctx, args);
    await store.logCall({
      clientId: client.clientId,
      userId: client.user.id,
      tool: tool.name,
      argsHash: createHash('sha256').update(JSON.stringify(args)).digest('hex'),
      outcome: outcome.isOk() ? 'ok' : outcome.error.code,
      durationMs: Date.now() - started,
    });
    if (outcome.isErr()) return failure(outcome.error);

    const value = JSON.parse(JSON.stringify(tool.present(outcome.value))) as unknown;
    if (key && args.dryRun !== true) {
      await store.saveIdempotent({
        clientId: client.clientId,
        key,
        tool: tool.name,
        response: value,
      });
    }
    return result(value);
  });

  return mcp;
}
