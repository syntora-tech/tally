import { describe, expect, it } from 'vitest';
import { mapDbError } from './errors';

describe('mapDbError', () => {
  it('maps I10 violations with the first open month from the hint', () => {
    const error = new Error('Failed query', {
      cause: { code: 'TL010', message: 'terms_in_closed_period', hint: '2026-08-01' },
    });
    const mapped = mapDbError(error);
    expect(mapped?.code).toBe('closed_period');
    expect(mapped?.message).toContain('01.08.2026');
  });

  it.each([
    ['23505', 'conflict'],
    ['23503', 'conflict'],
    ['23514', 'validation_error'],
    ['42501', 'forbidden'],
  ])('maps %s to %s', (code, expected) => {
    expect(mapDbError({ code })?.code).toBe(expected);
  });

  it('ignores non-database errors', () => {
    expect(mapDbError(new Error('boom'))).toBeNull();
    expect(mapDbError({ code: 'ENOENT' })).toBeNull();
  });
});
