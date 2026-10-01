import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A far-future month and an own number sequence keep the shared local database untouched.
const MONTH = '2036-03';
const SEQUENCE = 'e2e:invoice';
const clientName = unique('E2E Stage2 Client');
const personName = unique('E2E Stage2 Dev');

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
        insert into public.number_sequence (key, template) values (${SEQUENCE}, 'E{seq}/{yy}')
        on conflict (key) do nothing
      ),
      cl as (insert into public.client (legal_name) values (${clientName}) returning id),
      ct as (
        insert into public.contract (kind, number, company_id, client_id, number_sequence_key)
        select 'client', 'E2E-S2', co.id, cl.id, ${SEQUENCE} from co, cl returning id
      ),
      p as (insert into public.person (full_name) values (${personName}) returning id),
      a as (
        insert into public.assignment (person_id, contract_id, role_title, starts_on)
        select p.id, ct.id, 'Developer', '2036-01-01' from p, ct returning id
      ),
      b as (
        insert into public.billing_terms (assignment_id, valid_from, type, rate)
        select a.id, '2036-01-01', 'hourly', 47 from a
      )
      insert into public.pay_terms (assignment_id, valid_from, type, amount)
      select a.id, '2036-01-01', 'hourly', 3000 from a
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
      await tx.execute(sql`
        delete from public.job where payload ->> 'invoiceId' in (
          select i.id::text from public.invoice i join public.client c on c.id = i.client_id
          where c.legal_name = ${clientName})
      `);
      await tx.execute(sql`
        delete from public.document d using public.document_link l, public.client c
        where l.document_id = d.id and l.entity_id = c.id and c.legal_name = ${clientName}
      `);
      await tx.execute(sql`
        delete from public.invoice i using public.client c
        where c.id = i.client_id and c.legal_name = ${clientName}
      `);
      await tx.execute(sql`delete from public.timesheet t using public.period p
        where p.id = t.period_id and p.month = ${`${MONTH}-01`}`);
      await tx.execute(sql`delete from public.period where month = ${`${MONTH}-01`}`);
      await tx.execute(sql`
        delete from public.assignment a using public.person p
        where p.id = a.person_id and p.full_name = ${personName}
      `);
      await tx.execute(sql`delete from public.person where full_name = ${personName}`);
      await tx.execute(sql`delete from public.contract where number = 'E2E-S2'`);
      await tx.execute(sql`delete from public.client where legal_name = ${clientName}`);
      await tx.execute(sql`delete from public.number_sequence where key = ${SEQUENCE}`);
    });
  } finally {
    await client.end();
  }
});

test('stage 2: period → draft invoice → issue with number → revision keeps the number', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);

  await page.goto('/periods');
  await page.getByLabel('Month').fill(MONTH);
  await page.getByRole('button', { name: 'Open period' }).click();
  await expect(page).toHaveURL(/\/periods\/[0-9a-f-]+$/);

  await page.getByLabel(`Hours: ${personName}, ${clientName}`).fill('176');
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Hours saved')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Close period' }).click();
  const draftLink = page.getByRole('link', { name: `${clientName} — draft` });
  await expect(draftLink).toBeVisible();
  // 9.2 invoice column: 176 h × 47 $/h.
  await expect(draftLink.locator('..')).toContainText(/8,272\.00/);

  await draftLink.click();
  await expect(page.getByRole('heading', { name: /Invoice draft/ })).toBeVisible();
  await expect(page.getByLabel('Issue date')).toHaveValue('2036-04-01');
  await page.getByRole('button', { name: 'Issue and assign a number' }).click();
  await expect(page.getByRole('heading', { name: /Invoice No\. E1\/36/ })).toBeVisible();

  await page.getByLabel('Quantity').fill('170');
  await page.getByLabel('Reason for the change').fill('Client corrected hours');
  await page.getByRole('button', { name: 'Save new revision' }).click();
  await expect(page.getByRole('heading', { name: /Invoice No\. E1\/36/ })).toContainText(
    'revision 2',
  );
  await expect(page.getByText('Client corrected hours')).toBeVisible();
  await expect(page.getByText(/7,990\.00/).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText('The file for revision 2 is generated')).toBeVisible({
    timeout: 15_000,
  });
});
