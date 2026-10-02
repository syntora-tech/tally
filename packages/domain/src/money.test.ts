import { describe, expect, it } from 'vitest';
import { formatAmount, parseDecimal, roundHalfUp, sum, toDbNumeric, toDecimal } from './money';

describe('parseDecimal', () => {
  it.each(['0', '-12.5', '93174.60', '959.922092', ' 1400.2 '])('accepts %s', (input) => {
    expect(parseDecimal(input).isOk()).toBe(true);
  });

  it.each(['', '1,5', '1e3', 'abc', '1.', '.5', '--1', 'NaN'])('rejects %j', (input) => {
    expect(parseDecimal(input)._unsafeUnwrapErr()).toEqual({ code: 'invalid_decimal', input });
  });
});

describe('toDecimal', () => {
  it('throws on invalid strings', () => {
    expect(() => toDecimal('1,5')).toThrow('Invalid decimal string');
  });
});

describe('roundHalfUp', () => {
  it('rounds half up where binary floats round down', () => {
    expect(roundHalfUp('2.675').toFixed(2)).toBe('2.68');
    expect(roundHalfUp('1.005').toFixed(2)).toBe('1.01');
    expect(roundHalfUp('0.005').toFixed(2)).toBe('0.01');
  });

  it('rounds negatives away from zero on .5', () => {
    expect(roundHalfUp('-2.675').toFixed(2)).toBe('-2.68');
  });

  it('supports rate scale', () => {
    expect(roundHalfUp('43.0500004', 6).toFixed(6)).toBe('43.050000');
  });

  it('reproduces the July 2026 CTO act amount (spec 5.2)', () => {
    const uah = roundHalfUp(toDecimal('2020').times('44.48')).plus('3325');
    expect(uah.toFixed(2)).toBe('93174.60');
  });
});

describe('sum', () => {
  it('has no float drift', () => {
    expect(sum(['0.1', '0.2']).toString()).toBe('0.3');
  });

  it('returns zero for an empty list', () => {
    expect(sum([]).toString()).toBe('0');
  });

  it('adds the July 2026 invoice total (spec 9.2)', () => {
    expect(sum(['5500.00', '8648.00', '225.00']).toFixed(2)).toBe('14373.00');
  });
});

describe('toDbNumeric', () => {
  it('pads and rounds to the column scale', () => {
    expect(toDbNumeric('1198.8', 8)).toBe('1198.80000000');
    expect(toDbNumeric('0.123456789', 8)).toBe('0.12345679');
  });
});

describe('formatAmount', () => {
  const nb = ' ';

  it('groups thousands with a narrow no-break space and keeps a dot decimal', () => {
    expect(formatAmount('93174.6', 'UAH')).toBe(`93${nb}174.60${nb}UAH`);
    expect(formatAmount('1234567.891', 'USD', { grouping: 'comma' })).toBe(`1,234,567.89${nb}USD`);
    expect(formatAmount('1000000')).toBe(`1${nb}000${nb}000.00`);
  });

  it('handles small and negative values', () => {
    expect(formatAmount('0')).toBe('0.00');
    expect(formatAmount('999.999')).toBe(`1${nb}000.00`);
    expect(formatAmount('-8779.3', 'UAH')).toBe(`-8${nb}779.30${nb}UAH`);
    expect(formatAmount('-0.001')).toBe('0.00');
  });

  it('respects custom fraction digits', () => {
    expect(formatAmount('959.922092', 'USDC', { dp: 6 })).toBe(`959.922092${nb}USDC`);
    expect(formatAmount('12', undefined, { dp: 0 })).toBe('12');
  });

  it('shows significant digits up to maxDp without padding them', () => {
    expect(formatAmount('34.37500000', 'USD', { maxDp: 8 })).toBe(`34.375${nb}USD`);
    expect(formatAmount('1437.50000000', undefined, { maxDp: 8 })).toBe(`1${nb}437.50`);
    expect(formatAmount('46', undefined, { maxDp: 8 })).toBe('46.00');
    expect(formatAmount('0.123456789', undefined, { maxDp: 8 })).toBe('0.12345679');
    expect(formatAmount('7', undefined, { dp: 0, maxDp: 2 })).toBe('7');
    expect(formatAmount('-0.000000001', undefined, { maxDp: 8 })).toBe('0.00');
  });

  it('uses a decimal comma when asked', () => {
    expect(formatAmount('125095.2', undefined, { decimal: 'comma' })).toBe(`125${nb}095,20`);
  });
});
