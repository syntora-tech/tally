import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const plan = unique('E2E director salary');
const uah = unique('E2E salary UAH');

test.afterAll(async () => {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(sql`
      delete from public.transaction t using public.posting p, public.account a
      where p.transaction_id = t.id and a.id = p.account_id and a.name = ${uah}
    `);
    await db.execute(sql`delete from public.account where name = ${uah}`);
    await db.execute(sql`
      delete from public.planned_payment where parent_id is not null and planned_expense_id in
        (select id from public.planned_expense where name = ${plan})
    `);
    await db.execute(sql`
      delete from public.planned_payment where planned_expense_id in
        (select id from public.planned_expense where name = ${plan})
    `);
    await db.execute(sql`delete from public.planned_expense where name = ${plan}`);
  } finally {
    await client.end();
  }
});

test('planned payments: salary in two parts with taxes, marked paid (A-082)', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/ledger/accounts');
  await page.locator('#acc-new-name').fill(uah);
  await page.locator('#acc-new-currency').fill('UAH');
  await page.locator('#acc-new-opening').fill('100000');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText(uah).first()).toBeVisible();

  await page.goto('/ledger/planned?tab=plans');
  await page.locator('#pe-new-name').fill(plan);
  await page.locator('#pe-new-category').selectOption({ label: 'Payroll' });
  await page.locator('#pe-new-amount').fill('11401.68');
  await page.locator('#pe-new-day').fill('22');
  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.getByText('Planned expense added')).toBeVisible();

  const card = page.getByTestId('planned-expense').filter({ hasText: plan });
  const id = (await card.locator('input[name="id"]').first().getAttribute('value')) ?? '';
  await card.locator(`#part-${id}-name`).fill('Advance');
  await card.locator(`#part-${id}-amount`).fill('5500');
  await card.locator(`#part-${id}-day`).fill('22');
  await card.locator(`#part-${id}-name`).press('Enter');
  await expect(page.getByText('Part saved')).toBeVisible();
  await card.locator(`#part-${id}-name`).fill('Rest');
  await card.locator(`#part-${id}-day`).fill('7');
  await card.locator(`#part-${id}-offset`).selectOption('1');
  await card.locator(`#part-${id}-name`).press('Enter');

  for (const [name, mode, rate] of [
    ['PIT', 'withheld', '18'],
    ['ESV', 'on_top', '22'],
  ] as const) {
    await card.locator(`#charge-${id}-name`).fill(name);
    await card.locator(`#charge-${id}-mode`).selectOption(mode);
    await card.locator(`#charge-${id}-rate`).fill(rate);
    await card.locator(`#charge-${id}-fee-fixed`).fill('5');
    await card.locator(`#charge-${id}-name`).press('Enter');
    await expect(card.locator(`input[value="${name}"]`)).toBeVisible();
  }

  await page.getByRole('link', { name: 'Payments' }).click();
  const advance = page
    .getByTestId('planned-payment')
    .filter({ hasText: 'Advance' })
    .filter({ hasText: /of gross 5,500\.00/ })
    .first();
  // 5 500 − 18 % PIT = 4 510.00 to the director; ESV 1 210.00 besides it.
  await expect(advance).toContainText('4,510.00');
  await advance.getByRole('button', { name: 'Paid…' }).click();
  await advance.getByLabel('Paid by').selectOption('new');
  const account = await advance.locator('option', { hasText: uah }).getAttribute('value');
  await advance.getByLabel('Account').selectOption(account ?? '');
  await advance.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Payment marked paid')).toBeVisible();
  await expect(advance).toContainText('Paid');
  // The new expense pays the net amount, not the gross.
  await expect(advance.getByRole('link')).toContainText('4,510.00');
});
