import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A far-future month and an own number sequence keep the shared local database untouched.
const MONTH = '2036-05';
const SEQUENCE = 'e2e:early';
const clientName = unique('E2E Early Client');
const personName = unique('E2E Early Dev');

const dbUrl = () =>
  localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test.beforeAll(async () => {
  const { db, sql: client } = createDb(dbUrl(), { max: 1 });
  try {
    await db.execute(sql`
      insert into public.company (name_en, name_ua)
      select 'E2E company', 'E2E компанія' where not exists (select 1 from public.company)
    `);
    await db.execute(sql`
      with co as (select id from public.company order by created_at limit 1),
      seq as (
        insert into public.number_sequence (key, template) values (${SEQUENCE}, 'EE{seq}/{yy}')
        on conflict (key) do nothing
      ),
      cl as (insert into public.client (legal_name) values (${clientName}) returning id),
      ct as (
        insert into public.contract (kind, number, company_id, client_id, number_sequence_key)
        select 'client', 'E2E-EARLY', co.id, cl.id, ${SEQUENCE} from co, cl returning id
      ),
      p as (insert into public.person (full_name) values (${personName}) returning id),
      a as (
        insert into public.assignment (person_id, contract_id, role_title, starts_on, ends_on)
        select p.id, ct.id, 'Developer', '2036-05-01', '2036-05-31' from p, ct returning id
      ),
      b as (
        insert into public.billing_terms (assignment_id, valid_from, type, rate)
        select a.id, '2036-05-01', 'hourly', 47 from a
      )
      insert into public.pay_terms (assignment_id, valid_from, type, amount)
      select a.id, '2036-05-01', 'hourly_rate', 25 from a
    `);
  } finally {
    await client.end();
  }
});

test.afterAll(async () => {
  const { db, sql: client } = createDb(dbUrl(), { max: 1 });
  try {
    await db.transaction(async (tx) => {
      // Issued invoices and closed periods are protected by triggers; only test cleanup skips them.
      await tx.execute(sql`set local session_replication_role = replica`);
      const period = sql`(select id from public.period where month = ${`${MONTH}-01`})`;
      await tx.execute(sql`
        delete from public.job where payload ->> 'invoiceId' in (
          select i.id::text from public.invoice i join public.client c on c.id = i.client_id
          where c.legal_name = ${clientName})
      `);
      await tx.execute(sql`
        delete from public.document d using public.document_link l, public.client c
        where l.document_id = d.id and l.entity_id = c.id and c.legal_name = ${clientName}
      `);
      // Closing drafts monthly FOP acts for every fiat payout of the month (A-076).
      await tx.execute(sql`delete from public.supplier_act a using public.payroll_item i
        where i.id = a.payroll_item_id and i.period_id = ${period}`);
      await tx.execute(sql`delete from public.payroll_line l using public.payroll_item i
        where i.id = l.payroll_item_id and i.period_id = ${period}`);
      await tx.execute(sql`delete from public.payroll_item where period_id = ${period}`);
      await tx.execute(sql`delete from public.invoice_line l using public.invoice i
        where i.id = l.invoice_id and i.period_id = ${period}`);
      await tx.execute(sql`delete from public.invoice where period_id = ${period}`);
      await tx.execute(sql`delete from public.timesheet where period_id = ${period}`);
      await tx.execute(sql`delete from public.period where month = ${`${MONTH}-01`}`);
      await tx.execute(sql`
        delete from public.billing_terms b using public.assignment a, public.person p
        where a.id = b.assignment_id and p.id = a.person_id and p.full_name = ${personName}
      `);
      await tx.execute(sql`
        delete from public.pay_terms t using public.assignment a, public.person p
        where a.id = t.assignment_id and p.id = a.person_id and p.full_name = ${personName}
      `);
      await tx.execute(sql`
        delete from public.assignment a using public.person p
        where p.id = a.person_id and p.full_name = ${personName}
      `);
      await tx.execute(sql`delete from public.person where full_name = ${personName}`);
      await tx.execute(sql`delete from public.contract where number = 'E2E-EARLY'`);
      await tx.execute(sql`delete from public.client where legal_name = ${clientName}`);
      await tx.execute(sql`delete from public.number_sequence where key = ${SEQUENCE}`);
    });
  } finally {
    await client.end();
  }
});

test('A-076: invoice before the close → issue → its hours are frozen → close keeps it', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);

  await page.goto('/periods');
  await page.getByLabel('Month').fill(MONTH);
  await page.getByRole('button', { name: 'Open period' }).click();
  await expect(page).toHaveURL(/\/periods\/[0-9a-f-]+$/);
  const periodUrl = page.url();

  await page.getByLabel(`Hours: ${personName}, ${clientName}`).fill('100');
  await page.getByLabel(`Person hours for ${personName}, ${clientName}`).fill('104');
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Hours saved')).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(`E2E-EARLY`) });
  await row.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page.getByText('Invoice draft ready')).toBeVisible();
  // 100 client hours × 47; the person's 104 hours do not reach the invoice.
  const draft = row.getByRole('link', { name: /draft · 4,700\.00 USD/ });
  await expect(draft).toBeVisible();

  await draft.click();
  await page.getByRole('button', { name: 'Issue and assign a number' }).click();
  await expect(page.getByRole('heading', { name: /Invoice No\. EE1\/36/ })).toBeVisible();

  await page.goto(periodUrl);
  await page.getByLabel(`Hours: ${personName}, ${clientName}`).fill('110');
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText(/These hours are on issued invoice EE1\/36/)).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Close period' }).click();
  await expect(page.getByRole('button', { name: 'Reopen period' })).toBeVisible();
  await expect(page.getByRole('link', { name: `${clientName} — draft` })).toHaveCount(0);
});
