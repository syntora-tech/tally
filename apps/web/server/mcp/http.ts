import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Db } from '@tally/db';
import type { LocalDate } from '@tally/domain';
import type { ServiceConfig } from '../services/context';
import { looksLikeToken } from '../services/mcp/token';
import { createMcpServer, type McpStore } from './server';
import type { McpClient } from './store';

export type McpHttpDeps = {
  db: Db;
  today: LocalDate;
  config: ServiceConfig;
  store: McpStore;
  findClient: (token: string) => Promise<McpClient | null>;
  tokenExists: (token: string) => Promise<boolean>;
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * `/api/mcp`: Streamable HTTP in stateless mode (a fresh server per request, no sessions), so it
 * runs as a plain Vercel Function. Auth is a bearer personal access token (A-054); a revoked
 * client gets 403 even though its token is still well-formed (13.6).
 */
export async function handleMcpRequest(request: Request, deps: McpHttpDeps): Promise<Response> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!looksLikeToken(token)) {
    return json(
      401,
      { error: 'unauthorized', message: 'Send Authorization: Bearer <Tally MCP token>' },
      { 'www-authenticate': 'Bearer realm="tally"' },
    );
  }
  const client = await deps.findClient(token);
  if (!client) {
    return (await deps.tokenExists(token))
      ? json(403, { error: 'forbidden', message: 'This MCP client was revoked' })
      : json(
          401,
          { error: 'unauthorized', message: 'Unknown token' },
          {
            'www-authenticate': 'Bearer realm="tally", error="invalid_token"',
          },
        );
  }

  const server = createMcpServer({
    client,
    db: deps.db,
    today: deps.today,
    config: deps.config,
    store: deps.store,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
