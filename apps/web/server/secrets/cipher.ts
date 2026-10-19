import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { err, ok, type Result } from 'neverthrow';

const VERSION = 'v1';

/**
 * AES-256-GCM for personal secrets (A-120). The user id is authenticated data, so a ciphertext
 * copied to another user's row does not decrypt. Format: `v1:<iv>:<tag>:<ciphertext>` (base64).
 */
export function encryptSecret(keyBase64: string, userId: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(keyBase64), iv);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
    .join(':');
}

export function decryptSecret(
  keyBase64: string,
  userId: string,
  stored: string,
): Result<string, 'undecryptable'> {
  const [version, iv, tag, body] = stored.split(':');
  if (version !== VERSION || !iv || !tag || !body) return err('undecryptable');
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(keyBase64), Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return ok(
      Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
        'utf8',
      ),
    );
  } catch {
    // Wrong key (rotated APP_ENCRYPTION_KEY), another user's row, or a tampered value.
    return err('undecryptable');
  }
}

function keyOf(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes');
  return key;
}
