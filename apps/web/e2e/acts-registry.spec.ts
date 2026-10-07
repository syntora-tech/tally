import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-087: the supplier acts registry as its own page, laid out like the accountant's sheet.
const tag = unique('reg');
const fop = `ФОП Реєстр ${tag}`;

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

let payeeId = '';

test.beforeAll(async () => {
  payeeId = await withDb(async (db) => {
    await db.execute(sql`
      insert into public.company (name_en, name_ua)
      select 'E2E company', 'E2E компанія' where not exists (select 1 from public.company)
    `);
    const rows = await db.execute<{ id: string }>(sql`
      with co as (select id from public.company order by created_at limit 1),
      f as (insert into public.payee (kind, legal_name_ua) values ('fop', ${fop}) returning id),
      ct as (
        insert into public.contract (kind, number, company_id, payee_id)
        select 'fop', ${`OD-R-${tag}`}, co.id, f.id from co, f returning id
      ),
      acts as (
        insert into public.supplier_act
          (contract_id, payee_id, type, act_date, period_from, period_to, amount_uah, status, number, is_legacy)
        select ct.id, f.id, 'monthly', v.d::date, date_trunc('month', v.d::date)::date,
          v.d::date, v.amount::numeric, v.status::doc_status, v.number, true
        from ct, f, (values
          ('2041-01-31', '1000.50', 'issued', 'R - А1'),
          ('2041-03-29', '2000.25', 'issued', 'R - А3')
        ) as v(d, amount, status, number)
      )
      select id from f
    `);
    return rows[0]?.id ?? '';
  });
});

// Issued acts are immutable (I1); replica mode skips that trigger for the cleanup only.
test.afterAll(() =>
  withDb((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${payeeId}`);
      await tx.execute(sql`delete from public.contract where payee_id = ${payeeId}`);
      await tx.execute(sql`delete from public.payee where id = ${payeeId}`);
    }),
  ),
);

test('acts by counterparty with a subtotal, missing months and an Excel copy', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/payroll/acts');
  await expect(page).toHaveURL(/\/acts$/);
  await expect(page.getByRole('heading', { name: 'Supplier acts registry' })).toBeVisible();

  await page.goto(`/acts?year=2041&payeeId=${payeeId}`);
  const registry = page.getByTestId('acts-registry');
  await expect(registry.getByRole('link', { name: 'R - А1' })).toBeVisible();
  await expect(registry.getByRole('link', { name: 'R - А3' })).toBeVisible();
  await expect(page.getByTestId('acts-subtotal')).toContainText(`Total ${fop}`);
  await expect(page.getByTestId('acts-subtotal')).toContainText('3,000.75');
  await expect(page.getByTestId('missing-periods')).toContainText('February 2041');
  await expect(page.getByTestId('acts-total')).toContainText('3,000.75');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Excel' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('syntora-supplier-acts-2041.xlsx');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
});
