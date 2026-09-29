import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>` sent by pg_cron (spec 10.4). */
export function verifyCronSecret(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const given = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
