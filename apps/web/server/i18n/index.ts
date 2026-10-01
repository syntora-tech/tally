import 'server-only';
import type { Metadata } from 'next';
import type { Messages } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { formatterFor, type Formatter } from '@/lib/format';
import { labelsFrom, type Labels } from '@/lib/labels';
import { localizeError, localizeMessage, type ServiceError } from '../services/errors';

export async function getLabels(): Promise<Labels> {
  return labelsFrom(await getTranslations('enums'));
}

export async function getFormat(): Promise<Formatter> {
  const [locale, months, rules] = await Promise.all([
    getLocale(),
    getTranslations('months'),
    getTranslations('rules'),
  ]);
  return formatterFor(
    locale,
    months as unknown as Parameters<typeof formatterFor>[1],
    rules as unknown as Parameters<typeof formatterFor>[2],
  );
}

/** Service error in the user's language, for Server Actions and pages. */
export async function localizeForUser(error: ServiceError): Promise<ServiceError> {
  const t = await getTranslations('errors');
  return localizeError(error, (key, values) =>
    t.has(key as never) ? t(key as never, values as never) : null,
  );
}

/** `generateMetadata` for a page: "<title> · Tally" in the UI language. */
export function pageTitle(key: keyof Messages['meta']) {
  return async (): Promise<Metadata> => {
    const t = await getTranslations('meta');
    return { title: `${t(key)} · Tally` };
  };
}

/** A single service message (e.g. a fallback label) in the user's language. */
export async function getLocalizeText(): Promise<(text: string) => string> {
  const t = await getTranslations('errors');
  return (text) =>
    localizeMessage(text, (key, values) =>
      t.has(key as never) ? t(key as never, values as never) : null,
    );
}
