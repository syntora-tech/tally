import type { Db } from '@tally/db';
import { parseLocalDate } from '@tally/domain';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { defineService } from './define-service';

const ctx: ServiceContext = {
  actor: { kind: 'anonymous' },
  today: parseLocalDate('2026-09-29')._unsafeUnwrap(),
  db: {} as Db,
  config: { allowedEmails: [] },
};

const echo = defineService({
  name: 'test.echo',
  input: z.object({ email: z.email().transform((e) => e.toLowerCase()), hours: z.string() }),
  handler: vi.fn((_ctx: ServiceContext, input: { email: string; hours: string }) =>
    Promise.resolve(ok(input)),
  ),
});

describe('defineService', () => {
  it('passes parsed input to the handler', async () => {
    const result = await echo.run(ctx, { email: 'Owner@Syntora.Tech', hours: '184' });
    expect(result._unsafeUnwrap()).toEqual({ email: 'owner@syntora.tech', hours: '184' });
  });

  it('returns a validation_error with field errors and skips the handler', async () => {
    vi.mocked(echo.handler).mockClear();
    const result = await echo.run(ctx, { email: 'nope' });
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe('validation_error');
    expect(Object.keys(error.fieldErrors ?? {})).toEqual(['email', 'hours']);
    expect(echo.handler).not.toHaveBeenCalled();
  });
});
