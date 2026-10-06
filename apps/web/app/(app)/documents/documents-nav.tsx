import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

const TABS = [
  { key: 'registry', href: '/documents' },
  { key: 'inbox', href: '/documents/inbox' },
  { key: 'checks', href: '/documents/checks' },
] as const;

/** Registry, inbox and checks of the documents section (A-079). */
export async function DocumentsNav({
  current,
  inboxCount,
}: {
  current: (typeof TABS)[number]['key'];
  inboxCount?: number;
}) {
  const t = await getTranslations('documentsNav');
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t('label')}>
      {TABS.map((tab) => (
        <Button
          key={tab.key}
          size="sm"
          variant={tab.key === current ? 'default' : 'outline'}
          render={<Link href={tab.href} />}
        >
          {t(tab.key)}
          {tab.key === 'inbox' && inboxCount ? ` (${String(inboxCount)})` : ''}
        </Button>
      ))}
    </nav>
  );
}
