import { expect, test } from '@playwright/test';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { E2E_VIEWER_EMAIL, signIn } from './helpers';

test('A-102: v1 by default; v2 is an opt-in per browser and can be switched back', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  const html = page.locator('html');
  await expect(html).not.toHaveClass(/\bv2\b/);

  await page.getByRole('button', { name: 'Try the new design' }).click();
  await expect(html).toHaveClass(/\bv2\b/);

  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav.getByText('Month', { exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Payroll' }).click();
  await expect(page).toHaveURL(/\/payroll/);
  await expect(nav.getByRole('link', { name: 'Payroll' })).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('navigation', { name: 'Breadcrumbs' }).getByText('Month'),
  ).toBeVisible();

  // The preference survives navigation and reloads.
  await page.reload();
  await expect(html).toHaveClass(/\bv2\b/);

  await page.getByRole('button', { name: 'Account and preferences' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Account and preferences' }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);

  await page.getByRole('button', { name: 'Account and preferences' }).click();
  await page.getByRole('menuitemradio', { name: 'Українська' }).click();
  await expect(html).toHaveAttribute('lang', 'uk');
  await expect(page.getByRole('navigation', { name: 'Модулі' }).getByText('Місяць')).toBeVisible();

  await page.getByRole('button', { name: 'Обліковий запис і налаштування' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(html).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'Account and preferences' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'New design (beta)' }).click();
  await expect(html).not.toHaveClass(/\bv2\b/);
  await expect(page.getByRole('button', { name: 'Try the new design' })).toBeVisible();
});

test('A-102: every module opens in the v2 shell; the system theme follows the OS', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const href of [
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
  ]) {
    const response = await page.goto(href);
    expect(response?.status(), href).toBe(200);
    await expect(page.getByRole('heading', { level: 1 }).first(), href).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Modules' }).locator('a[aria-current="page"]'),
      href,
    ).toHaveAttribute('href', href);
  }
  expect(errors).toEqual([]);

  await page
    .context()
    .addCookies([{ name: 'tally_theme', value: 'system', url: 'http://localhost:3000' }]);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});

test('A-102: the v2 sidebar keeps the role matrix', async ({ page }) => {
  await signIn(page, E2E_VIEWER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Modules' });
  await expect(nav.getByRole('link', { name: 'People' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Ledger' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Payroll' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await expect(nav.getByText('Month', { exact: true })).toHaveCount(0);
});

test('A-102: the v2 overview shows the same totals as v1', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  const ids = ['treasury-total', 'receivables-total', 'payable-total', 'awaiting-total'];
  await page.goto('/dashboard');
  const v1 = await Promise.all(ids.map((id) => page.getByTestId(id).innerText()));
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto('/dashboard');
  await expect(page.locator('html')).toHaveClass(/\bv2\b/);
  for (const [i, id] of ids.entries()) {
    await expect(page.getByTestId(id)).toHaveText(v1[i] ?? '');
  }
});
