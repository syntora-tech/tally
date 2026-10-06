import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-079: the case file of a client and the inbox/checks of the documents section.
const tag = unique('dos');
const customer = `Dossier Client ${tag}`;

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

let clientId = '';

test.beforeAll(async () => {
  clientId = await withDb(async (db) => {
    await db.execute(sql`
      insert into public.company (name_en, name_ua)
      select 'E2E company', 'E2E компанія' where not exists (select 1 from public.company)
    `);
    const rows = await db.execute<{ id: string }>(sql`
      with co as (select id from public.company order by created_at limit 1),
      cl as (insert into public.client (legal_name) values (${customer}) returning id),
      ct as (
        insert into public.contract (kind, number, company_id, client_id)
        select 'client', ${`MSA-${tag}`}, co.id, cl.id from co, cl returning id
      ),
      sow as (
        insert into public.contract_annex (contract_id, kind, number, title)
        select ct.id, 'sow', '1', 'Backend' from ct returning id
      ),
      doc as (
        insert into public.document (type, title, number, doc_date, url)
        values ('invoice', ${`Invoice ${tag}`}, ${`${tag}/26`}, '2026-08-03', 'https://x.test/i')
        returning id
      ),
      link as (
        insert into public.document_link (document_id, entity_type, entity_id)
        select doc.id, 'contract', ct.id from doc, ct
      )
      select id from cl
    `);
    return rows[0]?.id ?? '';
  });
});

test.afterAll(() =>
  withDb(async (db) => {
    await db.execute(sql`delete from public.document where title = ${`Invoice ${tag}`}`);
    await db.execute(
      sql`delete from public.contract_annex where contract_id in (select id from public.contract where number = ${`MSA-${tag}`})`,
    );
    await db.execute(sql`delete from public.contract where number = ${`MSA-${tag}`}`);
    await db.execute(sql`delete from public.client where legal_name = ${customer}`);
  }),
);

test('A-079: case file, documents to sort out and checks', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/clients/${clientId}`);
  const dossier = page.getByTestId('dossier');
  await expect(dossier).toContainText(`Contract MSA-${tag}`);
  await expect(dossier).toContainText('SOW 1');
  await expect(dossier).toContainText('No signed file attached');
  await dossier.getByText('August 2026').click();
  await expect(dossier.getByRole('link', { name: `Invoice ${tag}`, exact: true })).toBeVisible();

  await page.goto('/documents');
  await page.getByRole('link', { name: /To sort out/ }).click();
  await expect(page.getByRole('heading', { name: 'Documents to sort out' })).toBeVisible();
  await page.getByRole('link', { name: 'Checks' }).click();
  await expect(page.getByTestId('check-contracts')).toContainText(`MSA-${tag}`);
});
