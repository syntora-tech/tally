import { describe, expect, it } from 'vitest';
import type { LocalDate } from './local-date';
import { usdConverter } from './usd';

const q = (onDate: string, base: string, quote: string, rate: string) => ({
  onDate: onDate as LocalDate,
  base,
  quote,
  rate,
});

describe('usdConverter (5.4)', () => {
  const toUsd = usdConverter([
    q('2026-02-04', 'USD', 'UAH', '43'),
    q('2026-10-05', 'USD', 'UAH', '41.5'),
    q('2026-02-04', 'EUR', 'USD', '1.168'),
    q('2026-10-05', 'PLN', 'UAH', '11.41'),
  ]);

  it('treats stablecoins as dollars and uses the latest UAH rate', () => {
    expect(toUsd('157.922092', 'USDC')?.toFixed(6)).toBe('157.922092');
    expect(toUsd('4150', 'UAH')?.toFixed(2)).toBe('100.00');
  });

  it('uses a direct pair, else goes through UAH', () => {
    expect(toUsd('100', 'EUR')?.toFixed(2)).toBe('116.80');
    expect(toUsd('415', 'PLN')?.toFixed(2)).toBe('114.10');
  });

  it('gives null without a rate', () => {
    expect(toUsd('1', 'GBP')).toBeNull();
  });
});
