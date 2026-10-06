import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

const TABS = [
  { key: 'structure', href: '/documents', finance: false },
  { key: 'list', href: '/documents?view=list', finance: false },
  { key: 'inbox', href: '/documents/inbox', finance: true },
  { key: 'checks', href: '/documents/checks', finance: true },
] as const;

/** Tree, list, inbox and checks of the documents section (A-079, A-081). */
export async function DocumentsNav({
  current,
  inboxCount,
  finance = true,
}: {
  current: (typeof TABS)[number]['key'];
  inboxCount?: number;
  /** Inbox and checks are for finance roles only. */
  finance?: boolean;
}) {
  const t = await getTranslations('documentsNav');
  return (
    <nav className="flex flex-wrap gap-2" aria-label={t('label')}>
      {TABS.filter((tab) => finance || !tab.finance).map((tab) => (
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
