import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 period wizard (A-102) on a far-future month with its own client and person.
const MONTH = '2037-05';
const SEQUENCE = 'e2e:invoice-v2';
const clientName = unique('E2E PerV2 Client');
const personName = unique('E2E PerV2 Dev');

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
        select 'client', 'E2E-PV2', co.id, cl.id, ${SEQUENCE} from co, cl returning id
      ),
      p as (insert into public.person (full_name) values (${personName}) returning id),
      a as (
        insert into public.assignment (person_id, contract_id, role_title, starts_on)
        select p.id, ct.id, 'Developer', '2037-01-01' from p, ct returning id
      ),
      b as (
        insert into public.billing_terms (assignment_id, valid_from, type, rate)
        select a.id, '2037-01-01', 'hourly', 47 from a
      )
      insert into public.pay_terms (assignment_id, valid_from, type, amount)
      select a.id, '2037-01-01', 'hourly', 3000 from a
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
        create temp table own_docs on commit drop as
        select l.document_id as id from public.document_link l join public.client c
        on l.entity_id = c.id where c.legal_name = ${clientName}
      `);
      await tx.execute(
        sql`delete from public.document_link where document_id in (select id from own_docs)`,
      );
      await tx.execute(sql`delete from public.document where id in (select id from own_docs)`);
      for (const child of ['invoice_line', 'invoice_revision']) {
        await tx.execute(sql`
          delete from ${sql.identifier(child)} x using public.invoice i, public.client c
          where x.invoice_id = i.id and c.id = i.client_id and c.legal_name = ${clientName}
        `);
      }
      await tx.execute(sql`
        delete from public.invoice i using public.client c
        where c.id = i.client_id and c.legal_name = ${clientName}
      `);
      // Closing the month drafts FOP acts for every active payee, real ones included.
      await tx.execute(sql`delete from public.supplier_act
        where period_from >= ${`${MONTH}-01`} and period_from < ${`${MONTH}-01`}::date + interval '1 month'`);
      // Replica mode skips FK cascades: payouts of the month go before the period.
      await tx.execute(sql`delete from public.payroll_line l using public.payroll_item i, public.period p
        where l.payroll_item_id = i.id and i.period_id = p.id and p.month = ${`${MONTH}-01`}`);
      await tx.execute(sql`delete from public.payroll_item i using public.period p
        where i.period_id = p.id and p.month = ${`${MONTH}-01`}`);
      await tx.execute(sql`delete from public.adjustment j using public.period p
        where p.id = j.period_id and p.month = ${`${MONTH}-01`}`);
      await tx.execute(sql`delete from public.timesheet t using public.period p
        where p.id = t.period_id and p.month = ${`${MONTH}-01`}`);
      await tx.execute(sql`delete from public.period where month = ${`${MONTH}-01`}`);
      for (const terms of ['billing_terms', 'pay_terms']) {
        await tx.execute(sql`
          delete from ${sql.identifier(terms)} x using public.assignment a, public.person p
          where x.assignment_id = a.id and p.id = a.person_id and p.full_name = ${personName}
        `);
      }
      await tx.execute(sql`
        delete from public.assignment a using public.person p
        where p.id = a.person_id and p.full_name = ${personName}
      `);
      await tx.execute(sql`delete from public.person where full_name = ${personName}`);
      await tx.execute(sql`delete from public.contract where number = 'E2E-PV2'`);
      await tx.execute(sql`delete from public.client where legal_name = ${clientName}`);
      await tx.execute(sql`delete from public.number_sequence where key = ${SEQUENCE}`);
    });
  } finally {
    await client.end();
  }
});

test('v2 period: opened from a dialog, hours on step 2, closed on step 5', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);

  await page.goto('/periods');
  await page.getByRole('button', { name: 'Open a period' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Month').fill(MONTH);
  await dialog.getByRole('button', { name: 'Open period' }).click();
  await expect(page).toHaveURL(/\/periods\/[0-9a-f-]+$/);
  const url = page.url();

  const steps = page.getByRole('navigation', { name: 'Month close steps' });
  await expect(steps.getByRole('link', { name: /Hours/ })).toHaveAttribute('aria-current', 'step');
  await page.getByLabel(`Hours: ${personName}, ${clientName}`).fill('176');
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Hours saved')).toBeVisible();

  await page.getByRole('link', { name: 'Next: Calculation' }).click();
  await expect(page).toHaveURL(/step=3/);
  await expect(page.getByTestId('total-invoice')).toContainText('8,272.00');

  // An adjustment is a line of the calculation, under its person, and part of the total.
  await page.getByRole('button', { name: '+ Adjustment' }).click();
  const adjust = page.getByRole('dialog');
  await adjust.getByLabel('Person').selectOption({ label: personName });
  await adjust.getByLabel('Kind').selectOption('other');
  await adjust.getByLabel('Amount').fill('1000');
  await adjust.getByLabel('Reason').fill('Compensation: corporate services');
  await adjust.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Adjustment added')).toBeVisible();
  await page.keyboard.press('Escape');
  const line = page.getByTestId('calc-adjustment');
  await expect(line).toContainText(personName);
  await expect(line).toContainText('Compensation: corporate services');
  await expect(page.getByTestId('total-pay')).toContainText('1,000.00');

  // Until it is paid the adjustment can be changed (A-124).
  await line.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Amount').fill('1250');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Adjustment changed')).toBeVisible();
  await expect(page.getByTestId('total-pay')).toContainText('1,250.00');

  await page.getByRole('link', { name: 'Next: Payouts' }).click();
  await page.getByRole('link', { name: 'Next: Close' }).click();
  await expect(page.getByRole('link', { name: /^Next/ })).toHaveCount(0);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Close period' }).click();
  await expect(page.getByRole('link', { name: `${clientName} — draft` })).toBeVisible();
  await expect(page.getByTestId('period-status')).toHaveText('Closed');

  // A closed month opens on its last step, every step marked done.
  await page.goto(url);
  await expect(steps.getByRole('link', { name: /Period closed/ })).toHaveAttribute(
    'aria-current',
    'step',
  );
});
