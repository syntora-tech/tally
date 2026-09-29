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
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
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
import type { NavIcon, NavItem } from '@/lib/navigation';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  people: Users,
  clients: Building2,
  periods: CalendarRange,
  invoices: FileText,
  payroll: Wallet,
  ledger: Landmark,
  trips: Plane,
  documents: FolderOpen,
  settings: Settings,
};

type Props = {
  items: NavItem[];
  email: string;
  roleLabel: string;
  signOutAction: () => Promise<void>;
};

export function AppSidebar({ items, email, roleLabel, signOutAction }: Props) {
  const pathname = usePathname();

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
            <SidebarMenu aria-label="Модулі">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      tooltip={item.title}
                      render={<Link href={item.href} aria-current={active ? 'page' : undefined} />}
                    >
                      <Icon />
                      <span>{item.title}</span>
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
        <form action={signOutAction}>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton type="submit" tooltip="Вийти">
                <LogOut />
                <span>Вийти</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </form>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
