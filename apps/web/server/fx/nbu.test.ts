import { parseLocalDate } from '@tally/domain';
import { describe, expect, it } from 'vitest';
import { fetchNbuRate, type Fetcher } from './nbu';

const day = parseLocalDate('2026-09-21')._unsafeUnwrap();
const respond =
  (body: unknown, status = 200): Fetcher =>
  (url) => {
    expect(url).toContain('valcode=USD&date=20260921&json');
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
  };

describe('fetchNbuRate (5.4)', () => {
  it('returns the rate as a decimal string', async () => {
    const res = await fetchNbuRate(
      'USD',
      day,
      respond([
        { r030: 840, txt: 'Долар США', rate: 41.2345, cc: 'USD', exchangedate: '21.09.2026' },
      ]),
    );
    expect(res._unsafeUnwrap()).toEqual({ currency: 'USD', onDate: '2026-09-21', rate: '41.2345' });
  });

  it('reports an empty answer and HTTP errors', async () => {
    expect((await fetchNbuRate('USD', day, respond([])))._unsafeUnwrapErr().code).toBe(
      'nbu_no_rate',
    );
    expect((await fetchNbuRate('USD', day, respond({}, 503)))._unsafeUnwrapErr().code).toBe(
      'nbu_unavailable',
    );
  });
});
