import { parseLocalDate } from '@tally/domain';
import { describe, expect, it } from 'vitest';
import { resolveToday } from './today';

const fake = parseLocalDate('2026-09-21')._unsafeUnwrap();
const now = new Date('2026-09-29T22:30:00Z');

describe('resolveToday', () => {
  it('uses APP_TODAY outside production', () => {
    expect(resolveToday({ appToday: fake, vercelEnv: undefined, now })).toBe('2026-09-21');
    expect(resolveToday({ appToday: fake, vercelEnv: 'preview', now })).toBe('2026-09-21');
  });

  it('ignores APP_TODAY in production', () => {
    expect(resolveToday({ appToday: fake, vercelEnv: 'production', now })).toBe('2026-09-30');
  });

  it('uses the Kyiv calendar date', () => {
    expect(resolveToday({ appToday: undefined, vercelEnv: undefined, now })).toBe('2026-09-30');
  });
});
