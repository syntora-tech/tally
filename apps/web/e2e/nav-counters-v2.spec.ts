import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 sidebar counters (A-105): a planned payment due today shows on Ledger at once and leaves it
// when skipped, without a reload.
const plan = unique('E2E NAV plan');
const TODAY = '2031-03-16';

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

test('v2 sidebar: the Ledger counter follows planned payments due today', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.context().addCookies([
    { name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' },
    { name: 'tally_today', value: TODAY, url: 'http://localhost:3000' },
  ]);
  await page.goto('/ledger/planned?tab=plans');
  const ledger = page
    .getByRole('navigation', { name: 'Modules' })
    .getByRole('link', { name: /^Ledger/ });
  const counter = ledger.locator('[data-nav-counter]');
  const before = Number(
    (await counter.count()) ? await counter.getAttribute('data-nav-counter') : 0,
  );

  await page.getByRole('button', { name: '+ Planned expense' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#pe-new-name').fill(plan);
  await dialog.locator('#pe-new-category').selectOption({ label: 'Software / Tools' });
  await dialog.locator('#pe-new-amount').fill('40');
  await dialog.locator('#pe-new-currency').fill('USD');
  await dialog.locator('#pe-new-day').fill('16');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(counter).toHaveAttribute('data-nav-counter', String(before + 1));
  await expect(ledger).toContainText('due today or overdue');

  await page
    .getByRole('navigation', { name: 'Planned expenses' })
    .getByRole('link', { name: 'Payments' })
    .click();
  const payment = page.getByTestId('planned-payment').filter({ hasText: plan }).first();
  await payment.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Skip…' }).click();
  await page.getByRole('dialog').getByLabel('Why skipped').fill('Paused');
  await page.getByRole('dialog').getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (before) await expect(counter).toHaveAttribute('data-nav-counter', String(before));
  else await expect(counter).toHaveCount(0);
});
