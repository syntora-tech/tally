'use client';

import { Languages } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { LOCALES, type Locale } from '@/i18n/locales';
import { setLocaleAction } from '@/server/actions/locale';

const NAMES: Record<Locale, string> = { en: 'English', uk: 'Українська' };

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const t = useTranslations('nav');
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-2 px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      <Languages className="size-4" aria-hidden />
      <span className="sr-only">{t('language')}</span>
      <select
        aria-label={t('language')}
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          startTransition(() => setLocaleAction(next));
        }}
        className="h-7 flex-1 rounded-md border border-input bg-transparent px-1.5 text-xs text-foreground"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
