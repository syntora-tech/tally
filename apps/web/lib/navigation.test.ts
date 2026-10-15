import { describe, expect, it } from 'vitest';
import { navItemForPath, navItemsFor, navSectionsFor } from './navigation';

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
      '/acts',
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

describe('navSectionsFor', () => {
  const sections = (role: Parameters<typeof navSectionsFor>[0]) =>
    navSectionsFor(role).map((s) => [s.group, s.items.map((i) => i.href)]);

  it('groups every owner module exactly once, in v2 order', () => {
    expect(sections('owner')).toEqual([
      ['overview', ['/dashboard']],
      ['month', ['/periods', '/invoices', '/payroll', '/acts']],
      ['money', ['/ledger', '/trips']],
      ['directory', ['/people', '/clients', '/documents']],
      ['system', ['/settings']],
    ]);
    const flat = navSectionsFor('owner').flatMap((s) => s.items.map((i) => i.href));
    expect([...flat].sort()).toEqual([...navItemsFor('owner').map((i) => i.href)].sort());
  });

  it('keeps the role matrix and drops empty sections', () => {
    expect(sections('viewer')).toEqual([
      ['overview', ['/dashboard']],
      ['money', ['/trips']],
      ['directory', ['/people', '/clients', '/documents']],
    ]);
  });
});

describe('navItemForPath', () => {
  const items = navItemsFor('owner');

  it('matches nested pages to their module', () => {
    expect(navItemForPath(items, '/payroll')?.href).toBe('/payroll');
    expect(navItemForPath(items, '/people/payees/123')?.href).toBe('/people');
    expect(navItemForPath(items, '/ledger/new')?.href).toBe('/ledger');
  });

  it('does not match on a bare prefix', () => {
    expect(navItemForPath(items, '/actsx')).toBeUndefined();
    expect(navItemForPath(items, '/')).toBeUndefined();
  });
});
