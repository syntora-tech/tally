import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const tag = unique('trip');
const traveller = `Traveller ${tag}`;
const tripA = `Conf A ${tag}`;
const tripB = `Conf B ${tag}`;
const uah = `E2E Trips UAH ${tag}`;

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
    await db.execute(sql`delete from public.trip where title in (${tripA}, ${tripB})`);
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

async function addExpense(page: Page) {
  await page.locator('#exp-description').fill(`Taxi ${tag}`);
  await page.locator('#exp-amount').fill('10.98');
  await page.locator('#exp-rate').fill('51.8');
  await page.getByRole('button', { name: 'Add expense' }).click();
}

test('AC 6.8: expenses, duplicate receipts and a settled reimbursement', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await createTrip(page, tripA);
  await page.locator('#exp-date').fill('2026-06-21');
  await addExpense(page);
  await expect(page.getByText('Expense added')).toBeVisible();
  await expect(page.getByTestId('trip-summary')).toContainText('568.76');
  await expect(page.getByTestId('trip-status')).toHaveText('Awaiting reimbursement');

  await createTrip(page, tripB);
  await page.locator('#exp-date').fill('2026-06-21');
  await addExpense(page);
  await expect(page.getByText(`already in “${tripA}”`)).toBeVisible();
  await expect(page.getByTestId('trip-expense')).toHaveCount(0);

  await page.goto('/trips');
  await page.getByRole('link', { name: tripA }).click();
  await page.locator('#re-method').selectOption('direct_payment');
  await page.getByRole('button', { name: 'Add reimbursement' }).click();
  await expect(page.getByText('Reimbursement added')).toBeVisible();
  const reimbursement = page.getByTestId('reimbursement');
  await reimbursement.getByLabel('Paying account').selectOption({ label: `${uah} (UAH)` });
  await reimbursement.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByTestId('trip-status')).toHaveText('Settled');
  await expect(page.getByTestId('trip-summary')).toContainText('0.00');
});
