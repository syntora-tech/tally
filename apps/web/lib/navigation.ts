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
  { href: '/dashboard', title: 'dashboard', icon: 'dashboard', roles: ALL_ROLES },
  { href: '/people', title: 'people', icon: 'people', roles: ALL_ROLES },
  { href: '/clients', title: 'clients', icon: 'clients', roles: ALL_ROLES },
  { href: '/periods', title: 'periods', icon: 'periods', roles: FINANCE_ROLES },
  { href: '/invoices', title: 'invoices', icon: 'invoices', roles: FINANCE_ROLES },
  { href: '/payroll', title: 'payroll', icon: 'payroll', roles: FINANCE_ROLES },
  { href: '/ledger', title: 'ledger', icon: 'ledger', roles: FINANCE_ROLES },
  { href: '/trips', title: 'trips', icon: 'trips', roles: ALL_ROLES },
  { href: '/documents', title: 'documents', icon: 'documents', roles: ALL_ROLES },
  { href: '/settings', title: 'settings', icon: 'settings', roles: OWNER_ROLES },
];

export function navItemsFor(role: AppRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}
