import { z } from 'zod';

/** Per-browser UI preferences kept in cookies (A-102): the v2 redesign is opt-in until it is complete. */
export const UI_VERSION_COOKIE = 'tally_ui';
export const THEME_COOKIE = 'tally_theme';

export const uiVersionSchema = z.enum(['v1', 'v2']);
export const themeSchema = z.enum(['light', 'dark', 'system']);

export type UiVersion = z.infer<typeof uiVersionSchema>;
export type Theme = z.infer<typeof themeSchema>;

export const THEMES = themeSchema.options;

export function parseUiVersion(value: unknown): UiVersion {
  const parsed = uiVersionSchema.safeParse(value);
  return parsed.success ? parsed.data : 'v1';
}

export function parseTheme(value: unknown): Theme {
  const parsed = themeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'system';
}
