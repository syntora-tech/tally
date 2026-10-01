import type { Messages } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from './locales';

/** No locale routing: the language is a per-browser preference in a cookie, English by default (A-058). */
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return {
    locale,
    messages: ((await import(`../messages/${locale}.json`)) as { default: Messages }).default,
    timeZone: 'Europe/Kyiv',
  };
});
