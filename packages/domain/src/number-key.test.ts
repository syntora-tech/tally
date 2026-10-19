import { describe, expect, it } from 'vitest';
import { formatSequenceNumber, numberKey, renumberedInFormat, sequenceValueOf } from './number-key';

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

describe('an issued number in the current format (A-119)', () => {
  it('keeps the counter and takes the new format', () => {
    expect(sequenceValueOf('1002 - А12')).toBe(12);
    expect(sequenceValueOf('MF281025/12')).toBe(12);
    expect(renumberedInFormat('1002 - А12', 'OD-1002 - А{seq}', 2026)).toBe('OD-1002 - А12');
    expect(renumberedInFormat('1002 - А12', '{contract}-А{seq}', 2026, 'OD-1002')).toBe(
      'OD-1002-А12',
    );
  });

  it('is null when already in format or the counter is not last', () => {
    expect(renumberedInFormat('OD-1002 - А12', 'OD-1002 - А{seq}', 2026)).toBeNull();
    expect(renumberedInFormat('12/26', '{seq}/{yy}', 2026)).toBeNull();
    expect(renumberedInFormat('no digits', 'A{seq}', 2026)).toBeNull();
  });
});
