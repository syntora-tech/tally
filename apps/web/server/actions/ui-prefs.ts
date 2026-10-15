'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { THEME_COOKIE, themeSchema, UI_VERSION_COOKIE, uiVersionSchema } from '@/lib/ui-prefs';

const YEAR = 60 * 60 * 24 * 365;

async function setPreference(name: string, value: string) {
  (await cookies()).set(name, value, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}

/** Opt in or out of the v2 redesign for this browser (A-102); no account or data change. */
export async function setUiVersionAction(version: string) {
  const parsed = uiVersionSchema.safeParse(version);
  if (parsed.success) await setPreference(UI_VERSION_COOKIE, parsed.data);
}

export async function setThemeAction(theme: string) {
  const parsed = themeSchema.safeParse(theme);
  if (parsed.success) await setPreference(THEME_COOKIE, parsed.data);
}
