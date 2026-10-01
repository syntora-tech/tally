import { createHash, randomBytes } from 'node:crypto';

const PREFIX = 'tally_pat_';

/** A personal access token for MCP clients (A-053); only its SHA-256 is stored. */
export function generateToken() {
  const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;
  return {
    token,
    hash: hashToken(token),
    hint: token.slice(-4),
    clientId: `pat_${randomBytes(6).toString('hex')}`,
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const looksLikeToken = (value: string) => value.startsWith(PREFIX) && value.length > 40;
