import { describe, expect, it } from 'vitest';
import { navItemsFor } from './navigation';

const hrefs = (role: Parameters<typeof navItemsFor>[0]) => navItemsFor(role).map((i) => i.href);

describe('navItemsFor', () => {
  it('shows every module to the owner', () => {
    expect(hrefs('owner')).toEqual([
      '/dashboard',
      '/people',
      '/clients',
      '/periods',
      '/invoices',
      '/payroll',
      '/ledger',
      '/trips',
      '/documents',
      '/settings',
    ]);
  });

  it('hides settings from finance', () => {
    expect(hrefs('finance')).not.toContain('/settings');
    expect(hrefs('finance')).toContain('/ledger');
  });

  it('hides financial modules from viewer (spec 4.4)', () => {
    expect(hrefs('viewer')).toEqual(['/dashboard', '/people', '/clients', '/trips', '/documents']);
  });
});
