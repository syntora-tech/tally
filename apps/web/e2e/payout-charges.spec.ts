import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const name = unique('E2E Abroad');
const db = () =>
  createDb(localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
    max: 1,
  });
let personId = '';

test.beforeAll(async () => {
  const { db: d, sql: client } = db();
  try {
    const rows = await d.execute<{ id: string }>(
      sql`insert into public.person (full_name) values (${name}) returning id`,
    );
    personId = [...rows][0]?.id ?? '';
  } finally {
    await client.end();
  }
});

test.afterAll(async () => {
  const { db: d, sql: client } = db();
  try {
    await d.execute(sql`delete from public.payment_charge where person_id = ${personId}`);
    await d.execute(sql`delete from public.person where id = ${personId}`);
  } finally {
    await client.end();
  }
});

test('a tax on every payout of a person is added on the person page (A-082)', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/people/${personId}`);
  await page.getByText('Taxes on payouts').click();
  await page.locator(`#charge-${personId}-name`).fill('Tax 20 %');
  await page.locator(`#charge-${personId}-rate`).fill('20');
  await page.locator(`#charge-${personId}-name`).press('Enter');
  await expect(page.getByText('Charge saved')).toBeVisible();
  await expect(page.locator('input[value="Tax 20 %"]')).toBeVisible();
  // With a tax in place, the form for another one folds under "+ Add a tax".
  await expect(page.locator(`#charge-${personId}-name`)).toBeHidden();
  await page.getByText('+ Add a tax').click();
  await expect(page.locator(`#charge-${personId}-name`)).toBeVisible();
});
