import { createDb } from '@tally/db';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 people directory (A-102): rarer filters fold under "More filters" and apply on Enter, a
// person's card is split into tabs.
const solidityDev = unique('E2E PV2 Solidity');
const rustDev = unique('E2E PV2 Rust');

async function v2(page: Page) {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
}

test.afterAll(async () => {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(
      sql`delete from public.person where full_name in (${solidityDev}, ${rustDev})`,
    );
  } finally {
    await client.end();
  }
});

test('v2 people: a person is added, found by filters and opened by tabs', async ({ page }) => {
  await v2(page);
  for (const [name, stack, rate] of [
    [solidityDev, 'Solidity, TypeScript', '45'],
    [rustDev, 'Rust', '40'],
  ] as const) {
    await page.goto('/people');
    await page.getByRole('link', { name: '+ Add person' }).click();
    await page.getByLabel('Full name').fill(name);
    await page.getByLabel('Stack').fill(stack);
    await page.getByLabel('Market rate, $/h').fill(rate);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name })).toBeVisible();
  }

  await page.goto('/people');
  const filters = page.getByRole('group', { name: 'Filters' });
  await filters.getByRole('button', { name: 'More filters' }).click();
  await filters.getByRole('searchbox', { name: 'Stack' }).fill('Solidity');
  await filters.getByRole('searchbox', { name: 'Stack' }).press('Enter');
  await expect(page).toHaveURL(/stack=Solidity/);
  await filters.getByRole('searchbox', { name: 'Rate up to, $/h' }).fill('50');
  await filters.getByRole('searchbox', { name: 'Rate up to, $/h' }).press('Enter');
  await expect(page).toHaveURL(/maxRate=50/);
  await expect(page.getByRole('cell', { name: solidityDev })).toBeVisible();
  await expect(page.getByRole('cell', { name: rustDev })).toHaveCount(0);

  await page.getByRole('cell', { name: solidityDev }).click();
  const tabs = page.getByRole('navigation', { name: solidityDev });
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('Solidity', { exact: true })).toBeVisible();
  await tabs.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL(/tab=history/);
  await expect(page.getByText('Created')).toBeVisible();

  await page.goto('/people');
  await page
    .getByRole('navigation', { name: 'People' })
    .getByRole('link', { name: 'Payout recipients' })
    .click();
  await expect(page).toHaveURL(/\/people\/payees$/);
  await expect(page.getByRole('link', { name: '+ Add payee' })).toBeVisible();
});
