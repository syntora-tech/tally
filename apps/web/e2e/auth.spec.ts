import { expect, test, type Page } from '@playwright/test';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { countMessagesTo, waitForMagicLink } from './mailpit';

const SENT_TEXT = 'Якщо цей email має доступ до Tally';

async function requestLink(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Надіслати посилання для входу' }).click();
  await expect(page.getByRole('status')).toContainText(SENT_TEXT);
}

test('anonymous visitors are sent to the login page', async ({ page }) => {
  await page.goto('/payroll');
  await expect(page).toHaveURL(/\/login\?next=%2Fpayroll$/);
  await expect(page.getByText('Вхід до back-office Syntora.Tech')).toBeVisible();
});

test('whitelisted email signs in with a magic link and becomes owner', async ({ page }) => {
  await requestLink(page, E2E_OWNER_EMAIL);
  await page.goto(await waitForMagicLink(E2E_OWNER_EMAIL));

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId('current-user-email')).toHaveText(E2E_OWNER_EMAIL);
  await expect(page.getByText('Власник')).toBeVisible();

  const nav = page.getByRole('list', { name: 'Модулі' });
  for (const title of ['Огляд', 'Люди', 'Інвойси', 'Виплати', 'Ledger', 'Налаштування']) {
    await expect(nav.getByRole('link', { name: title })).toBeVisible();
  }

  await nav.getByRole('link', { name: 'Виплати' }).click();
  await expect(page.getByRole('heading', { name: 'Виплати' })).toBeVisible();

  await page.getByRole('button', { name: 'Вийти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('email outside the whitelist gets no magic link', async ({ page }) => {
  const stranger = 'stranger@tally.test';
  await requestLink(page, stranger);
  // Give the auth server time to (not) deliver.
  await page.waitForTimeout(1500);
  expect(await countMessagesTo(stranger)).toBe(0);
});

test('invalid email is rejected by the form', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('not-an-email@');
  await page.getByLabel('Email').evaluate((el) => {
    (el as HTMLInputElement).type = 'text';
  });
  await page.getByRole('button', { name: 'Надіслати посилання для входу' }).click();
  await expect(page.getByText('Введіть коректний email')).toBeVisible();
});
