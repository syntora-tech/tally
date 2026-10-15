import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 planned expenses (A-104): the plan's form opens from the header, the payment's rare actions
// sit under ⋯, and a plan's parts unfold under its row.
const plan = unique('E2E PV2 plan');

test.afterAll(async () => {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(sql`
      delete from public.planned_payment where planned_expense_id in
        (select id from public.planned_expense where name = ${plan})`);
    await db.execute(sql`delete from public.planned_expense where name = ${plan}`);
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

test('v2 planned: a plan from the header dialog, its payment skipped from ⋯', async ({ page }) => {
  await v2(page);
  await page.goto('/ledger/planned?tab=plans');
  await page.getByRole('button', { name: '+ Planned expense' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#pe-new-name').fill(plan);
  await dialog.locator('#pe-new-category').selectOption({ label: 'Software / Tools' });
  await dialog.locator('#pe-new-amount').fill('40');
  await dialog.locator('#pe-new-currency').fill('USD');
  await dialog.locator('#pe-new-day').fill('28');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByTestId('planned-expense').filter({ hasText: plan });
  await expect(row).toContainText('monthly on day 28');

  await row.getByRole('button', { name: `Parts, taxes and charges of ${plan}` }).click();
  await expect(row.getByText('Parts within the month')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Planned expenses' })
    .getByRole('link', { name: 'Payments' })
    .click();
  const payment = page.getByTestId('planned-payment').filter({ hasText: plan }).first();
  await expect(payment).toContainText('To pay');
  await payment.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Skip…' }).click();
  await page.getByRole('dialog').getByLabel('Why skipped').fill('Paused');
  await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(payment).toContainText('Skipped');
});
