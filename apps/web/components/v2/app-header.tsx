'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { navItemForPath, type NavItem } from '@/lib/navigation';

export function V2AppHeader({ items }: { items: NavItem[] }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const item = navItemForPath(items, pathname);
  const nested = item !== undefined && pathname !== item.href;

  return (
    <header className="sticky top-0 z-20 flex h-13 items-center gap-3 border-b bg-card/90 px-4 backdrop-blur md:px-8">
      <SidebarTrigger className="-ml-1" />
      <nav aria-label={t('breadcrumbs')} className="flex min-w-0 items-center gap-2 text-sm">
        {item && item.group !== 'overview' && item.group !== 'system' ? (
          <>
            <span className="text-muted-foreground">{t(`groups.${item.group}`)}</span>
            <span className="text-muted-foreground" aria-hidden>
              /
            </span>
          </>
        ) : null}
        {item ? (
          nested ? (
            <Link href={item.href} className="truncate text-muted-foreground hover:text-foreground">
              {t(item.title)}
            </Link>
          ) : (
            <span className="truncate font-medium" aria-current="page">
              {t(item.title)}
            </span>
          )
        ) : null}
        <span id="v2-crumb" data-nested={nested} className="contents" />
      </nav>
    </header>
  );
}
