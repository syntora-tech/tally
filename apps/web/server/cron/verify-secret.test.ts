import { describe, expect, it } from 'vitest';
import { verifyCronSecret } from './verify-secret';

const secret = 'local-cron-secret-0123456789';

describe('verifyCronSecret', () => {
  it('accepts the exact bearer secret', () => {
    expect(verifyCronSecret(`Bearer ${secret}`, secret)).toBe(true);
  });

  it.each([
    [null],
    [''],
    [secret],
    [`Bearer ${secret}x`],
    [`Bearer ${secret.slice(0, -1)}`],
    [`bearer ${secret}`],
  ])('rejects %j', (header) => {
    expect(verifyCronSecret(header, secret)).toBe(false);
  });

  it('rejects everything when no secret is configured', () => {
    expect(verifyCronSecret('Bearer ', undefined)).toBe(false);
    expect(verifyCronSecret('Bearer ', '')).toBe(false);
  });
});
