'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense, use } from 'react';
import { cn } from 'cn';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { navItemForPath, type NavSection } from '@/lib/navigation';
import type { NavCounter } from '@/server/services/dashboard/nav-counters';
import { UserMenu, type UserMenuProps } from './user-menu';

const UNLABELLED = new Set(['overview', 'system']);

type CounterKey =
  'dashboard' | 'periods' | 'invoices' | 'payroll' | 'acts' | 'ledger' | 'documents';

function Counter({
  counters,
  href,
  title,
}: {
  counters: Promise<Record<string, NavCounter>>;
  href: string;
  title: string;
}) {
  const t = useTranslations('nav.counters');
  const c = use(counters)[href];
  if (!c) return null;
  const label = t(title as CounterKey, { count: c.count ?? 0 });
  if (c.count === null) {
    return (
      <span
        role="img"
        data-nav-counter=""
        aria-label={label}
        title={label}
        className={cn('ml-auto size-2 shrink-0 rounded-full', c.urgent ? 'bg-red-500' : 'bg-neon')}
      />
    );
  }
  return (
    <span
      data-nav-counter={c.count}
      title={label}
      className={cn(
        'ml-auto min-w-5 shrink-0 rounded-full px-1.5 text-center text-[11px] leading-5 font-semibold tabular-nums',
        c.urgent ? 'bg-red-500 text-white' : 'bg-white/12 text-white',
      )}
    >
      <span aria-hidden>{c.count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function V2AppSidebar({
  sections,
  user,
  counters,
}: {
  sections: NavSection[];
  user: UserMenuProps;
  counters: Promise<Record<string, NavCounter>>;
}) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const active = navItemForPath(
    sections.flatMap((s) => s.items),
    pathname,
  );

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <svg viewBox="0 0 28 32" className="size-7! shrink-0" aria-hidden>
                <path
                  d="M14 1 27 8.5v15L14 31 1 23.5v-15Z"
                  fill="none"
                  stroke="var(--neon)"
                  strokeWidth="2"
                />
                <path d="M9 12h10M14 12v10" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span className="flex flex-col leading-tight">
                <span className="font-heading text-base font-bold text-white">Tally</span>
                <span className="text-xs text-sidebar-foreground/70">Syntora.Tech</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('modules')} className="contents">
          {sections.map((section) => (
            <SidebarGroup key={section.group} className="py-1">
              {UNLABELLED.has(section.group) ? null : (
                <SidebarGroupLabel className="text-[11px] tracking-wider text-sidebar-foreground/55 uppercase">
                  {t(`groups.${section.group}`)}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {section.items.map((item) => {
                    const isActive = active?.href === item.href;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={isActive}
                          className="h-9 data-active:font-medium"
                          render={
                            <Link href={item.href} aria-current={isActive ? 'page' : undefined} />
                          }
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'size-1.5 shrink-0 rounded-full',
                              isActive ? 'bg-neon' : 'bg-[#4A4A4F]',
                            )}
                          />
                          <span>{t(item.title)}</span>
                          <Suspense>
                            <Counter counters={counters} href={item.href} title={item.title} />
                          </Suspense>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu {...user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
