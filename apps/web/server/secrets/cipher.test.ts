import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './cipher';

const key = randomBytes(32).toString('base64');

describe('secret cipher', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = encryptSecret(key, 'user-1', 'sk-ant-api03-secret');
    const b = encryptSecret(key, 'user-1', 'sk-ant-api03-secret');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('secret');
    expect(decryptSecret(key, 'user-1', a)._unsafeUnwrap()).toBe('sk-ant-api03-secret');
  });

  it('refuses another user, another key and tampering', () => {
    const stored = encryptSecret(key, 'user-1', 'sk-ant-api03-secret');
    expect(decryptSecret(key, 'user-2', stored).isErr()).toBe(true);
    expect(decryptSecret(randomBytes(32).toString('base64'), 'user-1', stored).isErr()).toBe(true);
    const [v, iv, tag, body = ''] = stored.split(':');
    const flipped = `${v}:${iv}:${tag}:${body.slice(0, -2)}AA`;
    expect(decryptSecret(key, 'user-1', flipped).isErr()).toBe(true);
    expect(decryptSecret(key, 'user-1', 'garbage').isErr()).toBe(true);
  });
});
