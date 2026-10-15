import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 Ledger (A-102): accounts from a dialog, the journal filtered by chips and instant filters.
const usd = unique('E2E LV2 USD');
const usdt = unique('E2E LV2 USDT');
const income = unique('E2E LV2 income');
const spend = unique('E2E LV2 spend');

test.afterAll(async () => {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(sql`
      delete from public.transaction t using public.posting p, public.account a
      where p.transaction_id = t.id and a.id = p.account_id and a.name in (${usd}, ${usdt})
    `);
    await db.execute(sql`delete from public.account where name in (${usd}, ${usdt})`);
  } finally {
    await client.end();
  }
});

async function v2(page: Page) {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
}

async function newTx(
  page: Page,
  tx: { type: string; category: string; account: string; amount: string; description: string },
) {
  await page.goto('/ledger');
  await page.getByRole('link', { name: '+ Transaction' }).click();
  await expect(page).toHaveURL(/\/ledger\/new$/);
  await page.getByRole('radio', { name: tx.type === 'revenue' ? 'Revenue' : 'Expense' }).click();
  await page.getByLabel('Category').selectOption({ label: tx.category });
  const side = tx.type === 'revenue' ? '#to' : '#from';
  await page.locator(`${side}-account`).selectOption({ label: `${tx.account} (USD)` });
  await page.locator(`${side}-amount`).fill(tx.amount);
  await page.getByLabel('Description').fill(tx.description);
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
}

test('v2 ledger: accounts in dialogs, chips and instant filters over the journal', async ({
  page,
}) => {
  await v2(page);
  await page.goto('/ledger');
  const sections = page.getByRole('navigation', { name: 'Ledger sections' });
  await expect(sections.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await sections.getByRole('link', { name: 'Accounts' }).click();
  await expect(page).toHaveURL(/\/ledger\/accounts$/);

  for (const [name, currency, opening] of [
    [usd, 'USD', '1000'],
    [usdt, 'USD', '0'],
  ] as const) {
    await page.getByRole('button', { name: '+ New account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#acc-new-name').fill(name);
    await dialog.locator('#acc-new-currency').fill(currency);
    await dialog.locator('#acc-new-opening').fill(opening);
    await dialog.getByRole('button', { name: 'Add' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('account-row').filter({ hasText: name })).toContainText(
      `${Number(opening).toLocaleString('en-US')}.00`,
    );
  }

  // Editing keeps the dialog pattern and closes on save.
  await page
    .getByTestId('account-row')
    .filter({ hasText: usdt })
    .getByRole('button', { name: 'Edit' })
    .click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await newTx(page, {
    type: 'revenue',
    category: 'Client Revenue',
    account: usd,
    amount: '500',
    description: income,
  });
  await newTx(page, {
    type: 'expense',
    category: 'Contractors',
    account: usdt,
    amount: '120',
    description: spend,
  });

  const chips = page.getByRole('navigation', { name: 'Accounts' });
  await expect(chips.getByRole('link', { name: new RegExp(usd) })).toContainText('1,500.00');
  await chips.getByRole('link', { name: new RegExp(usdt) }).click();
  await expect(page).toHaveURL(/accountId=/);
  const rows = page.getByTestId('ledger-row');
  await expect(rows.filter({ hasText: spend })).toBeVisible();
  await expect(rows.filter({ hasText: income })).toHaveCount(0);
  await expect(rows.filter({ hasText: spend }).getByTestId('allocation')).toHaveText(
    'Not allocated',
  );

  await chips.getByRole('link', { name: /All accounts/ }).click();
  await expect(rows.filter({ hasText: income })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search transactions' }).fill(spend);
  await page.getByRole('searchbox', { name: 'Search transactions' }).press('Enter');
  await expect(page).toHaveURL(/q=/);
  await expect(rows.filter({ hasText: income })).toHaveCount(0);
  await expect(rows.filter({ hasText: spend })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  // Filters apply on change, no "Show" button.
  await page.getByRole('combobox', { name: 'Type' }).selectOption('expense');
  await expect(page).toHaveURL(/type=expense/);
  await expect(rows.filter({ hasText: income })).toHaveCount(0);
  await expect(rows.filter({ hasText: spend })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(rows.filter({ hasText: income })).toBeVisible();

  await rows.filter({ hasText: spend }).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete…' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Transaction deleted')).toBeVisible();
  await expect(rows.filter({ hasText: spend })).toHaveCount(0);
});
