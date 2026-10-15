import 'server-only';
import { cookies } from 'next/headers';
import { parseTheme, parseUiVersion, THEME_COOKIE, UI_VERSION_COOKIE } from '@/lib/ui-prefs';

export async function getUiPrefs() {
  const store = await cookies();
  return {
    version: parseUiVersion(store.get(UI_VERSION_COOKIE)?.value),
    theme: parseTheme(store.get(THEME_COOKIE)?.value),
  };
}
