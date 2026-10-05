import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const usd = unique('E2E Privat USD');
const uah = unique('E2E Privat UAH');

test.afterAll(async () => {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(sql`
      delete from public.transaction t using public.posting p, public.account a
      where p.transaction_id = t.id and a.id = p.account_id and a.name in (${usd}, ${uah})
    `);
    await db.execute(sql`delete from public.account where name in (${usd}, ${uah})`);
  } finally {
    await client.end();
  }
});

test('AC 6.7: accounts, revenue with a fee and an exchange with two actual amounts', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/ledger/accounts');
  for (const [name, currency, opening] of [
    [usd, 'USD', '3901.78'],
    [uah, 'UAH', '0'],
  ] as const) {
    await page.locator('#acc-new-name').fill(name);
    await page.locator('#acc-new-currency').fill(currency);
    await page.locator('#acc-new-opening').fill(opening);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(name).first()).toBeVisible();
  }

  await page.goto('/ledger/new');
  await page.getByLabel('Type').selectOption('revenue');
  await page.getByLabel('Category').selectOption({ label: 'Client Revenue' });
  await page.locator('#to-account').selectOption({ label: `${usd} (USD)` });
  await page.locator('#to-amount').fill('1000');
  await page.getByText('Fee (optional)').click();
  await page.getByLabel('Fee account').selectOption({ label: `${usd} (USD)` });
  await page.getByLabel('Fee amount').fill('5');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  await expect(page.getByRole('link', { name: usd }).locator('..')).toContainText(/4,896\.78/);

  await page.goto('/ledger/new');
  await page.getByLabel('Type').selectOption('fx_exchange');
  await page.locator('#from-account').selectOption({ label: `${usd} (USD)` });
  await page.locator('#from-amount').fill('2000');
  await page.locator('#to-account').selectOption({ label: `${uah} (UAH)` });
  await page.locator('#to-amount').fill('86100');
  await expect(page.getByText('1 USD = 43.050000 UAH')).toBeVisible();
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page.getByRole('link', { name: uah }).locator('..')).toContainText(/86,100\.00/);

  await page.getByRole('link', { name: 'Reconcile' }).click();
  await page.getByLabel('Account').selectOption({ label: `${usd} (USD)` });
  await page.getByLabel('Balance from the bank').fill('2900');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByTestId('reconcile-difference')).toHaveText(/3\.22/);
  await expect(page.getByText('Balances differ')).toBeVisible();
  await page.getByLabel('Balance from the bank').fill('2,896.78');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Balances match')).toBeVisible();
});
