import { createDb } from '@tally/db';
import { expect, test } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-111: the owner takes back a mistaken void from the act page.
const tag = unique('E2E RESTORE');
const ids = { company: '', payee: '', contract: '', act: '' };

function db() {
  return createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
}

test.beforeAll(async () => {
  const { db: d, sql: client } = db();
  const one = async (q: ReturnType<typeof sql>) =>
    ((await d.execute(q)) as unknown as { id: string }[])[0]?.id ?? '';
  try {
    ids.company = await one(
      sql`insert into public.company (name_en, name_ua) values ('R', 'Р') returning id`,
    );
    ids.payee = await one(
      sql`insert into public.payee (kind, legal_name_ua) values ('fop', ${`ФОП ${tag}`}) returning id`,
    );
    ids.contract = await one(
      sql`insert into public.contract (kind, number, company_id, payee_id) values ('fop', ${tag}, ${ids.company}, ${ids.payee}) returning id`,
    );
    ids.act = await one(
      sql`insert into public.supplier_act (contract_id, payee_id, type, act_date, period_from, period_to, amount_uah, is_legacy, status, number)
          values (${ids.contract}, ${ids.payee}, 'other', '2031-03-31', '2031-03-01', '2031-03-31', 500, true, 'issued', ${tag}) returning id`,
    );
    await d.execute(
      sql`update public.supplier_act set status = 'void', void_reason = 'Wrong click' where id = ${ids.act}`,
    );
  } finally {
    await client.end();
  }
});

test.afterAll(async () => {
  const { db: d, sql: client } = db();
  try {
    await d.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.supplier_act where id = ${ids.act}`);
    });
    await d.execute(sql`delete from public.contract where id = ${ids.contract}`);
    await d.execute(sql`delete from public.payee where id = ${ids.payee}`);
    await d.execute(sql`delete from public.company where id = ${ids.company}`);
  } finally {
    await client.end();
  }
});

test('a voided act is restored with its number from the ⋯ menu', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto(`/acts/${ids.act}`);
  await expect(page.getByTestId('act-status')).toHaveText('Void');
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Restore…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Why restore').fill('Voided by mistake');
  await dialog.getByRole('button', { name: 'Restore act' }).click();
  await expect(page.getByTestId('act-status')).toHaveText('Active');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(tag);
});
