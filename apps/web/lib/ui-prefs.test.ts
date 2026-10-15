import { describe, expect, it } from 'vitest';
import { parseTheme, parseUiVersion } from './ui-prefs';

describe('ui prefs', () => {
  it('falls back to v1 for anything but an exact version', () => {
    expect(parseUiVersion('v2')).toBe('v2');
    expect(parseUiVersion('v1')).toBe('v1');
    expect(parseUiVersion(undefined)).toBe('v1');
    expect(parseUiVersion('V2')).toBe('v1');
    expect(parseUiVersion('v3')).toBe('v1');
  });

  it('falls back to the system theme', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('')).toBe('system');
    expect(parseTheme('<script>')).toBe('system');
  });
});
