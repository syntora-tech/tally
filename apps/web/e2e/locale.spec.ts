import { expect, test } from '@playwright/test';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { signIn } from './helpers';

test('A-058: English by default, Ukrainian on request, the choice survives a reload', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/ledger/rates');
  const nav = page.getByRole('list', { name: 'Modules' });
  await expect(nav.getByRole('link', { name: 'People' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.getByLabel('Language').selectOption('uk');
  const ukNav = page.getByRole('list', { name: 'Модулі' });
  await expect(ukNav.getByRole('link', { name: 'Люди' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Курси валют' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');

  await page.getByLabel('Мова').selectOption('en');
  await expect(nav.getByRole('link', { name: 'People' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Exchange rates' })).toBeVisible();
});
