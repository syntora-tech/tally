import { getDb } from '@/server/db/client';
import { getServerEnv } from '@/server/env';
import { handleMcpRequest } from '@/server/mcp/http';
import * as store from '@/server/mcp/store';
import { getDocumentStorage } from '@/server/storage';
import { getToday } from '@/server/today';

export const maxDuration = 60;

function handle(request: Request) {
  const db = getDb();
  return handleMcpRequest(request, {
    db,
    today: getToday(),
    config: { allowedEmails: getServerEnv().ALLOWED_EMAILS },
    store: {
      recentCalls: (clientId, tools) => store.recentCalls(db, clientId, tools),
      logCall: (entry) => store.logCall(db, entry),
      findIdempotent: (clientId, key) => store.findIdempotent(db, clientId, key),
      saveIdempotent: (entry) => store.saveIdempotent(db, entry),
    },
    storage: getDocumentStorage,
    findClient: (token) => store.findClientByToken(db, token),
    tokenExists: (token) => store.tokenExists(db, token),
  });
}

export { handle as GET, handle as POST, handle as DELETE };
