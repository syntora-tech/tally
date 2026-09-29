import { describe, expect, it } from 'vitest';
import { formatSequenceNumber, numberKey } from './number-key';

describe('numbering (spec 5.6)', () => {
  it('formats the templates used in the seed', () => {
    expect(formatSequenceNumber('{seq}/{yy}', 25, 2026)).toBe('25/26');
    expect(formatSequenceNumber('1001 - А{seq}', 13, 2026)).toBe('1001 - А13');
    expect(formatSequenceNumber('{contract}-{yyyy}-{seq}', 7, 2031, 'MF1')).toBe('MF1-2031-7');
    expect(formatSequenceNumber('{seq}/{yy}', 1, 2105)).toBe('1/05');
  });

  it('builds search keys', () => {
    expect(numberKey('1001 - A13')).toBe('1001А13');
  });
});
