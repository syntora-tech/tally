import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const uah = unique('E2E Import UAH');
const ref = (n: number) => `E2E${Date.now().toString(36)}${String(n)}`;
const refs = [ref(1), ref(2), ref(3), ref(4)];
const header =
  'ЄДРПОУ;Рахунок;Валюта;Дата операції;Референс;Номер документа;Дебет;Кредит;Призначення платежу;Кореспондент;ЄДРПОУ кореспондента';
const statement = [
  'Виписка за жовтень',
  header,
  `1;UA000000000000000000000009999;UAH;07.10.2044;${refs[0] ?? ''};501;282,00;;Вiйськовий збiр вiд заробiтної плати;ГОЛОВНЕ УДКСУ;37607526`,
  `1;UA000000000000000000000009999;UAH;08.10.2044;${refs[1] ?? ''};502;500,00;;Оплата за послуги;ФОП Тестовий;1111111111`,
  `1;UA000000000000000000000009999;UAH;08.10.2044;${refs[2] ?? ''};503;5,00;;Комiсiя за платiж № 502;ПРИВАТБАНК;14360570`,
  `1;UA000000000000000000000009999;UAH;09.10.2044;${refs[3] ?? ''};504;120,00;;Підписка;ТОВ Ромашка;22222222`,
].join('\n');

function withDb<T>(fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>) {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  return fn(db).finally(() => client.end());
}

test.beforeAll(() =>
  withDb(async (db) => {
    await db.execute(sql`
      insert into public.account (name, kind, currency, opening_balance, opening_date)
      values (${uah}, 'bank', 'UAH', 1000, '2044-10-01')
    `);
    // No personal key: AI features must stay hidden.
    await db.execute(sql`
      delete from public.user_secret where user_id in (select id from public.app_user where email = ${E2E_OWNER_EMAIL})
    `);
  }),
);

test.afterAll(() =>
  withDb(async (db) => {
    await db.execute(sql`
      delete from public.transaction t using public.posting p, public.account a
      where p.transaction_id = t.id and a.id = p.account_id and a.name = ${uah}
    `);
    // Committed imports are frozen by a trigger (TL068); test cleanup bypasses it.
    await db.execute(sql`set session_replication_role = replica`);
    await db.execute(sql`
      delete from public.ledger_import where sources @> ${JSON.stringify([{ file: 'october.csv' }])}::jsonb
    `);
    await db.execute(sql`set session_replication_role = origin`);
    await db.execute(sql`delete from public.account where name = ${uah}`);
  }),
);

test('A-121: a statement is read, reviewed, booked once and recognised on the next upload', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/ledger');
  await page.getByRole('link', { name: 'Import', exact: true }).click();
  await expect(page.getByTestId('bank-import-form')).toBeVisible();
  await expect(page.getByTestId('crypto-import-form')).toHaveCount(0);

  const upload = async () => {
    await page.goto('/ledger/import');
    await page.locator('#import-files').setInputFiles({
      name: 'october.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(statement),
    });
    await page.locator('#import-account').selectOption({ label: `${uah} (UAH)` });
    await page.getByRole('button', { name: 'Read statement' }).click();
    await expect(page).toHaveURL(/\/ledger\/import\/[0-9a-f-]{36}$/);
  };

  await upload();
  const rows = page.getByTestId('import-row');
  await expect(rows).toHaveCount(4);
  const row = (counterparty: string) =>
    rows.filter({ has: page.getByText(counterparty, { exact: true }) });
  const tax = row('ГОЛОВНЕ УДКСУ');
  await expect(tax.getByLabel('Category')).toHaveValue(/.+/);
  await expect(tax).toContainText('by rule');
  const fee = row('ПРИВАТБАНК');
  await expect(fee.getByLabel('Part of')).toHaveValue(/.+/);

  await page.getByRole('tab', { name: /Need a category/ }).click();
  await expect(rows).toHaveCount(2);
  await row('ФОП Тестовий').getByLabel('Category').selectOption({ label: 'Contractors' });
  await row('ТОВ Ромашка').getByLabel('Category').selectOption({ label: 'Software / Tools' });
  await page.getByRole('tab', { name: /All/ }).click();

  await page.getByTestId('import-commit').click();
  await expect(page.getByTestId('import-committed')).toContainText(
    'Booked 3 transactions, linked 0.',
  );

  await page.goto('/ledger');
  // 1 000 − 282 tax − 500 payment − 5 fee − 120 subscription.
  await expect(page.getByRole('link', { name: uah }).locator('..')).toContainText(/93\.00/);

  await upload();
  await expect(rows).toHaveCount(4);
  await expect(page.locator('[data-testid="import-row"][data-status="duplicate"]')).toHaveCount(4);
  await expect(page.getByTestId('import-commit')).toBeDisabled();
});

test('A-120: Settings explains that a Claude Code subscription token is not an API key', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/settings');
  await expect(page.getByText('No key yet — AI features are hidden.')).toBeVisible();
  await page.locator('#ai-key').fill('sk-ant-oat01-a-subscription-token-123456');
  await page.getByRole('button', { name: 'Check and save' }).click();
  await expect(page.getByText(/This is a Claude Code subscription token/)).toBeVisible();
});
