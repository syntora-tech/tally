import 'server-only';
import { localDateInZone, type LocalDate } from '@tally/domain';
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
