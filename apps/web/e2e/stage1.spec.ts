import { createDb } from '@tally/db';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { E2E_VIEWER_EMAIL, localEnv, signIn, unique } from './helpers';

// Stage 1 acceptance criteria (spec 6.2, 6.3, 6.9) through the real UI.
test.describe.configure({ mode: 'serial' });

const solidityDev = unique('E2E Solidity');
const rustDev = unique('E2E Rust');
const clientName = unique('E2E Client');

async function createPerson(page: Page, name: string, stack: string, rate: string) {
  await page.goto('/people/new');
  await page.getByLabel('Повне ім’я').fill(name);
  await page.getByLabel('Стек').fill(stack);
  await page.getByLabel('Ринкова ставка, $/год').fill(rate);
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('owner sets company requisites and builds the bench', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/settings');
  await page.getByLabel('Назва (EN)').fill('LLC "SYNTORA"');
  await page.getByLabel('Назва (UA)').fill('ТОВ «СІНТОРА»');
  await page.getByRole('button', { name: 'Зберегти реквізити' }).click();
  await expect(page.getByText('Реквізити збережено')).toBeVisible();

  await createPerson(page, solidityDev, 'Solidity, TypeScript', '45');
  await createPerson(page, rustDev, 'Rust', '40');
});

test('AC 6.2: filter "Solidity, ≤ $50/h, available now"', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/people');
  await page.getByRole('link', { name: 'Доступні зараз' }).click();
  const filters = page.getByRole('form', { name: 'Фільтри' });
  await filters.getByLabel('Стек', { exact: true }).fill('Solidity');
  await filters.getByLabel('Ставка до, $/год').fill('50');
  await filters.getByRole('button', { name: 'Застосувати' }).click();
  await expect(page).toHaveURL(/stack=Solidity/);
  await expect(page.getByRole('cell', { name: solidityDev })).toBeVisible();
  await expect(page.getByRole('cell', { name: rustDev })).toHaveCount(0);
});

test('AC 6.3: back-dated rate change in a closed period is rejected', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/clients/new');
  await page.getByLabel('Юридична назва').fill(clientName);
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await page.getByRole('link', { name: 'Новий договір' }).click();
  await page.getByLabel('Номер договору').fill('MSA-E2E');
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByRole('heading', { name: 'Договір MSA-E2E' })).toBeVisible();

  await page.goto('/people');
  await page.getByRole('cell', { name: solidityDev }).click();
  await page.getByRole('link', { name: 'Нове залучення' }).click();
  await page
    .getByLabel('Договір (SOW / Annex клієнта)')
    .selectOption({ label: `${clientName} · MSA-E2E` });
  await page.getByLabel('Початок').fill('2026-01-05');
  await page.locator('#billing-rate').fill('47');
  await page.locator('#pay-amount').fill('3000');
  await page.getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByText('Маржа за умовами')).toBeVisible();

  // Close January as the stage-2 wizard will; periods have no UI yet. The test removes it again
  // because the local database is shared with integration tests.
  const dbUrl =
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const { db, sql: client } = createDb(dbUrl, { max: 1 });
  await db.execute(
    sql`insert into public.period (month, work_hours, status) values ('2026-01-01', 176, 'closed')`,
  );
  try {
    const billingForm = page
      .locator('form')
      .filter({ has: page.locator('input[name="side"][value="billing"]') });
    await billingForm.getByLabel('Діє з місяця').fill('2026-01');
    await billingForm.getByLabel('Ставка за годину').fill('50');
    await billingForm.getByRole('button', { name: 'Додати версію' }).click();
    await expect(billingForm.getByRole('alert')).toContainText(
      'Не можна змінювати умови заднім числом у закритому періоді',
    );
  } finally {
    await db.execute(sql`delete from public.period where month = '2026-01-01'`);
    await client.end();
  }
});

test('AC 6.9: documents without links and linked to three entities', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/documents/new');
  await page.getByLabel('Назва').fill(unique('E2E policy'));
  await page.getByLabel('Або посилання').fill('https://example.com/policy');
  await page.getByRole('button', { name: 'Додати документ' }).click();
  await expect(page.getByTestId('document-links')).toContainText('Без прив’язок');

  await page.goto('/documents/new');
  const title = unique('E2E NDA');
  await page.getByLabel('Тип').selectOption('nda');
  await page.getByLabel('Назва').fill(title);
  await page.getByLabel('Або посилання').fill('https://example.com/nda');
  const picker = page.getByLabel('Сутність для прив’язки');
  for (const label of [solidityDev, clientName, 'MSA-E2E']) {
    await picker.selectOption({ label });
    await page.getByRole('button', { name: 'Прив’язати' }).click();
  }
  await page.getByRole('button', { name: 'Додати документ' }).click();
  const chips = page.getByTestId('document-links');
  for (const label of [solidityDev, clientName, 'MSA-E2E'])
    await expect(chips).toContainText(label);

  await page.goto('/documents?q=E2E%20NDA');
  await expect(page.getByRole('link', { name: title })).toBeVisible();
});

test('AC 6.2: viewer sees the bench but no payees or finance modules', async ({ page }) => {
  await signIn(page, E2E_VIEWER_EMAIL);
  const nav = page.getByRole('list', { name: 'Модулі' });
  await expect(nav.getByRole('link', { name: 'Люди' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Виплати' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Налаштування' })).toHaveCount(0);

  await page.goto('/people');
  await expect(page.getByRole('link', { name: 'Одержувачі' })).toHaveCount(0);
  await page.getByRole('cell', { name: solidityDev }).click();
  await expect(page.getByText('Одержувач виплат')).toHaveCount(0);
  await expect(page.getByText('Залучення', { exact: true })).toHaveCount(0);

  await page.goto('/people/payees');
  await expect(page).toHaveURL(/\/dashboard$/);
});
