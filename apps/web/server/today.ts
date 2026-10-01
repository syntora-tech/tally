import 'server-only';
import { localDateInZone, parseLocalDate, type LocalDate } from '@tally/domain';
import { cookies } from 'next/headers';
import { getServerEnv } from './env';

export type ResolveTodayInput = {
  appToday: LocalDate | undefined;
  vercelEnv: string | undefined;
  now: Date;
};

/** `APP_TODAY` fakes the business date for tests and is ignored in production (spec 9). */
export function resolveToday({ appToday, vercelEnv, now }: ResolveTodayInput): LocalDate {
  if (appToday && vercelEnv !== 'production') return appToday;
  return localDateInZone(now, 'Europe/Kyiv');
}

export function getToday(): LocalDate {
  const env = getServerEnv();
  return resolveToday({ appToday: env.APP_TODAY, vercelEnv: env.VERCEL_ENV, now: new Date() });
}

export const TODAY_COOKIE = 'tally_today';

/**
 * Business date of a user request: `getToday()`, or the `tally_today` cookie when the e2e flag is
 * set (only Playwright's server does) and the deployment is not production — Playwright walks through 9.4 dates without restarting the server.
 */
export async function getRequestToday(): Promise<LocalDate> {
  const env = getServerEnv();
  if (env.ALLOW_TODAY_OVERRIDE === '1' && env.VERCEL_ENV !== 'production') {
    const raw = (await cookies()).get(TODAY_COOKIE)?.value;
    const parsed = raw ? parseLocalDate(raw) : null;
    if (parsed?.isOk()) return parsed.value;
  }
  return getToday();
}
