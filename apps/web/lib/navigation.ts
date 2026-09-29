import type { AppRole } from '@tally/db/schema';
import type { Route } from 'next';

export type NavIcon =
  | 'dashboard'
  | 'people'
  | 'clients'
  | 'periods'
  | 'invoices'
  | 'payroll'
  | 'ledger'
  | 'trips'
  | 'documents'
  | 'settings';

export type NavItem = {
  href: Route;
  title: string;
  icon: NavIcon;
  roles: readonly AppRole[];
};

export const ALL_ROLES: readonly AppRole[] = ['owner', 'finance', 'viewer'];
export const FINANCE_ROLES: readonly AppRole[] = ['owner', 'finance'];
export const OWNER_ROLES: readonly AppRole[] = ['owner'];

/** Module visibility mirrors the RLS matrix in spec 4.4; RLS remains the actual guard. */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', title: 'Огляд', icon: 'dashboard', roles: ALL_ROLES },
  { href: '/people', title: 'Люди', icon: 'people', roles: ALL_ROLES },
  { href: '/clients', title: 'Клієнти', icon: 'clients', roles: ALL_ROLES },
  { href: '/periods', title: 'Періоди', icon: 'periods', roles: FINANCE_ROLES },
  { href: '/invoices', title: 'Інвойси', icon: 'invoices', roles: FINANCE_ROLES },
  { href: '/payroll', title: 'Виплати', icon: 'payroll', roles: FINANCE_ROLES },
  { href: '/ledger', title: 'Ledger', icon: 'ledger', roles: FINANCE_ROLES },
  { href: '/trips', title: 'Відрядження', icon: 'trips', roles: ALL_ROLES },
  { href: '/documents', title: 'Документи', icon: 'documents', roles: ALL_ROLES },
  { href: '/settings', title: 'Налаштування', icon: 'settings', roles: OWNER_ROLES },
];

export function navItemsFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'Власник',
  finance: 'Фінанси',
  viewer: 'Перегляд',
};
