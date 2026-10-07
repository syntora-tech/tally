'use client';

import {
  Building2,
  CalendarRange,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Landmark,
  LogOut,
  Plane,
  ScrollText,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import type { Locale } from '@/i18n/locales';
import type { NavIcon, NavItem } from '@/lib/navigation';
import { LanguageSwitcher } from './language-switcher';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  people: Users,
  clients: Building2,
  periods: CalendarRange,
  invoices: FileText,
  payroll: Wallet,
  acts: ScrollText,
  ledger: Landmark,
  trips: Plane,
  documents: FolderOpen,
  settings: Settings,
};

type Props = {
  items: NavItem[];
  email: string;
  roleLabel: string;
  locale: Locale;
  signOutAction: () => Promise<void>;
};

export function AppSidebar({ items, email, roleLabel, locale, signOutAction }: Props) {
  const pathname = usePathname();
  const t = useTranslations('nav');

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <span className="flex size-8 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground">
                T
              </span>
              <span className="font-semibold">Tally</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu aria-label={t('modules')}>
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={t(item.title)}
                      render={<Link href={item.href} aria-current={active ? 'page' : undefined} />}
                    >
                      <Icon />
                      <span>{t(item.title)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col gap-0.5 px-2 py-1 text-xs group-data-[collapsible=icon]:hidden">
          <span className="truncate font-medium" data-testid="current-user-email">
            {email}
          </span>
          <span className="text-muted-foreground">{roleLabel}</span>
        </div>
        <LanguageSwitcher locale={locale} />
        <form action={signOutAction}>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton type="submit" tooltip={t('signOut')}>
                <LogOut />
                <span>{t('signOut')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </form>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
