import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 trip card (A-102): expenses and reimbursements are added from dialogs.
const tag = unique('trip');
const traveller = `Traveller V2 ${tag}`;
const tripA = `Conf V2 ${tag}`;
const uah = `E2E Trips V2 UAH ${tag}`;

async function withDb<T>(fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>) {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    return await fn(db);
  } finally {
    await client.end();
  }
}

test.beforeAll(() =>
  withDb(async (db) => {
    await db.execute(sql`insert into public.person (full_name) values (${traveller})`);
    await db.execute(sql`insert into public.account (name, kind, currency, opening_date)
      values (${uah}, 'bank', 'UAH', '2026-01-01')`);
  }),
);

test.afterAll(() =>
  withDb(async (db) => {
    await db.execute(sql`
      delete from public.transaction t using public.posting p, public.account a
      where p.transaction_id = t.id and a.id = p.account_id and a.name = ${uah}`);
    await db.execute(sql`delete from public.trip where title = ${tripA}`);
    await db.execute(sql`delete from public.account where name = ${uah}`);
    await db.execute(sql`delete from public.person where full_name = ${traveller}`);
  }),
);

async function createTrip(page: Page, title: string) {
  await page.goto('/trips/new');
  await page.locator('#trip-title').fill(title);
  await page.locator('#trip-location').fill('Berlin');
  await page.locator('#trip-from').fill('2026-06-15');
  await page.locator('#trip-to').fill('2026-06-21');
  await page.getByLabel(traveller).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

const card = (page: Page, title: string) =>
  page.locator('[data-slot=card]').filter({ has: page.getByText(title, { exact: true }) });

test('v2 trip: an expense and a reimbursement from dialogs settle the trip', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await createTrip(page, tripA);
  await expect(page.locator('#exp-description')).toHaveCount(0);

  await card(page, 'Expenses').getByRole('button', { name: '+ Add' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#exp-date').fill('2026-06-21');
  await dialog.locator('#exp-description').fill(`Taxi ${tag}`);
  await dialog.locator('#exp-amount').fill('10.98');
  await dialog.locator('#exp-rate').fill('51.8');
  await dialog.getByRole('button', { name: 'Add expense' }).click();
  await expect(page.getByText('Expense added')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('trip-summary')).toContainText('568.76');
  await expect(page.getByTestId('trip-status')).toHaveText('Awaiting reimbursement');

  await card(page, 'Reimbursements').getByRole('button', { name: '+ Add' }).click();
  await dialog.locator('#re-method').selectOption('direct_payment');
  await dialog.getByRole('button', { name: 'Add reimbursement' }).click();
  await expect(page.getByText('Reimbursement added')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  const reimbursement = page.getByTestId('reimbursement');
  await reimbursement.getByLabel('Paying account').selectOption({ label: `${uah} (UAH)` });
  await reimbursement.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('trip-status')).toHaveText('Settled');
});
