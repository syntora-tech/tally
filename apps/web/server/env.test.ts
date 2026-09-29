import { describe, expect, it } from 'vitest';
import { serverEnvSchema } from './env';

const base = {
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
};

describe('serverEnvSchema', () => {
  it('normalizes the email whitelist', () => {
    const env = serverEnvSchema.parse({
      ...base,
      ALLOWED_EMAILS: ' Owner@Syntora.Tech, ,cfo@syntora.tech ',
    });
    expect(env.ALLOWED_EMAILS).toEqual(['owner@syntora.tech', 'cfo@syntora.tech']);
  });

  it('defaults to an empty whitelist and local storage', () => {
    const env = serverEnvSchema.parse(base);
    expect(env.ALLOWED_EMAILS).toEqual([]);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.APP_TODAY).toBeUndefined();
  });

  it('validates APP_TODAY', () => {
    expect(serverEnvSchema.parse({ ...base, APP_TODAY: '2026-09-21' }).APP_TODAY).toBe(
      '2026-09-21',
    );
    expect(serverEnvSchema.safeParse({ ...base, APP_TODAY: '21.09.2026' }).success).toBe(false);
  });

  it('requires the database url', () => {
    expect(serverEnvSchema.safeParse({ ...base, DATABASE_URL: undefined }).success).toBe(false);
  });
});
