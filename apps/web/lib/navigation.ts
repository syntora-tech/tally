import type { AppRole } from '@tally/db/schema';
import type { Route } from 'next';

export type NavIcon =
  | 'dashboard'
  | 'people'
  | 'clients'
  | 'periods'
  | 'invoices'
  | 'payroll'
  | 'acts'
  | 'ledger'
  | 'trips'
  | 'documents'
  | 'settings';

/** v2 sidebar sections, in display order; v1 keeps the flat list. */
export const NAV_GROUPS = ['overview', 'month', 'money', 'directory', 'system'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export type NavItem = {
  href: Route;
  group: NavGroup;
  /** Key in the `nav` messages; equals the icon name. */
  title: NavIcon;
  icon: NavIcon;
  roles: readonly AppRole[];
};

export const ALL_ROLES: readonly AppRole[] = ['owner', 'finance', 'viewer'];
export const FINANCE_ROLES: readonly AppRole[] = ['owner', 'finance'];
export const OWNER_ROLES: readonly AppRole[] = ['owner'];

/** Module visibility mirrors the RLS matrix in spec 4.4; RLS remains the actual guard. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/dashboard',
    group: 'overview',
    title: 'dashboard',
    icon: 'dashboard',
    roles: ALL_ROLES,
  },
  { href: '/people', group: 'directory', title: 'people', icon: 'people', roles: ALL_ROLES },
  { href: '/clients', group: 'directory', title: 'clients', icon: 'clients', roles: ALL_ROLES },
  { href: '/periods', group: 'month', title: 'periods', icon: 'periods', roles: FINANCE_ROLES },
  { href: '/invoices', group: 'month', title: 'invoices', icon: 'invoices', roles: FINANCE_ROLES },
  { href: '/payroll', group: 'month', title: 'payroll', icon: 'payroll', roles: FINANCE_ROLES },
  { href: '/acts', group: 'month', title: 'acts', icon: 'acts', roles: FINANCE_ROLES },
  { href: '/ledger', group: 'money', title: 'ledger', icon: 'ledger', roles: FINANCE_ROLES },
  { href: '/trips', group: 'money', title: 'trips', icon: 'trips', roles: ALL_ROLES },
  {
    href: '/documents',
    group: 'directory',
    title: 'documents',
    icon: 'documents',
    roles: ALL_ROLES,
  },
  { href: '/settings', group: 'system', title: 'settings', icon: 'settings', roles: OWNER_ROLES },
];

export function navItemsFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export type NavSection = { group: NavGroup; items: NavItem[] };

export function navSectionsFor(role: AppRole): NavSection[] {
  const items = navItemsFor(role);
  return NAV_GROUPS.map((group) => ({
    group,
    items: items.filter((i) => i.group === group),
  })).filter((s) => s.items.length > 0);
}

/** The nav item a pathname belongs to (longest matching prefix), for v2 breadcrumbs. */
export function navItemForPath(items: readonly NavItem[], pathname: string): NavItem | undefined {
  return items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
