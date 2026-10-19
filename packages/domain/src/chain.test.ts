import { describe, expect, it } from 'vitest';
import { feeAmount, fromBaseUnits, tokenContract } from './chain';

describe('fromBaseUnits', () => {
  it('converts integer base units exactly', () => {
    expect(fromBaseUnits('1500000', 6)).toBe('1.5');
    expect(fromBaseUnits('123456789012345678', 18)).toBe('0.123456789012345678');
    expect(fromBaseUnits('0', 6)).toBe('0');
  });

  it('rejects anything but digits', () => {
    expect(fromBaseUnits('1.5', 6)).toBeNull();
    expect(fromBaseUnits('-1', 6)).toBeNull();
    expect(fromBaseUnits('', 6)).toBeNull();
  });
});

describe('feeAmount', () => {
  it('rounds to the numeric(20,8) scale half-up', () => {
    expect(feeAmount('0.000123456789')).toBe('0.00012346');
    expect(feeAmount('13.4')).toBe('13.4');
  });

  it('drops fees that round to zero', () => {
    expect(feeAmount('0.000000004')).toBeNull();
    expect(feeAmount('0')).toBeNull();
  });
});

describe('tokenContract', () => {
  it('accepts only the official contracts', () => {
    expect(tokenContract('ETH', '0xDAC17F958D2EE523A2206206994597C13D831EC7')?.symbol).toBe('USDT');
    expect(tokenContract('TRON', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')?.decimals).toBe(6);
    expect(tokenContract('ETH', '0xdac17f958d2ee523a2206206994597c13d831ec8')).toBeNull();
    expect(tokenContract('BSC', '0xdac17f958d2ee523a2206206994597c13d831ec7')).toBeNull();
  });
});
