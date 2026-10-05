import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-068 on a far-future month so real data stays untouched.
const MONTH = '2044-02';
const tag = unique('ag');
const dev = `Placed ${tag}`;
const customer = `Agency Client ${tag}`;
const agency = `ФОП Агенція ${tag}`;

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

test.beforeAll(() =>
  withDb(async (db) => {
    await db.execute(sql`
      insert into public.company (name_en, name_ua)
      select 'E2E company', 'E2E компанія' where not exists (select 1 from public.company)
    `);
    await db.execute(sql`insert into public.payee (kind, legal_name_ua) values ('fop', ${agency})`);
    await db.execute(sql`
      with co as (select id from public.company order by created_at limit 1),
      cl as (insert into public.client (legal_name) values (${customer}) returning id),
      ct as (
        insert into public.contract (kind, number, company_id, client_id)
        select 'client', ${`AG-${tag}`}, co.id, cl.id from co, cl returning id
      ),
      p as (insert into public.person (full_name) values (${dev}) returning id),
      a as (
        insert into public.assignment (person_id, contract_id, role_title, starts_on)
        select p.id, ct.id, 'Developer', '2044-01-01' from p, ct returning id
      ),
      b as (
        insert into public.billing_terms (assignment_id, valid_from, type, rate)
        select a.id, '2044-01-01', 'hourly', 47 from a
      )
      insert into public.pay_terms (assignment_id, valid_from, type, amount)
      select a.id, '2044-01-01', 'hourly', 3000 from a
    `);
  }),
);

test.afterAll(() =>
  withDb((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const periodIds = sql`(select id from public.period where month = ${`${MONTH}-01`})`;
      await tx.execute(
        sql`delete from public.payroll_line where payroll_item_id in (select id from public.payroll_item where period_id in ${periodIds})`,
      );
      await tx.execute(sql`delete from public.payroll_item where period_id in ${periodIds}`);
      await tx.execute(
        sql`delete from public.invoice_line where invoice_id in (select id from public.invoice where period_id in ${periodIds})`,
      );
      await tx.execute(sql`delete from public.invoice where period_id in ${periodIds}`);
      await tx.execute(sql`delete from public.timesheet where period_id in ${periodIds}`);
      await tx.execute(sql`delete from public.period where month = ${`${MONTH}-01`}`);
      const assignments = sql`(select a.id from public.assignment a join public.person p on p.id = a.person_id where p.full_name = ${dev})`;
      for (const table of ['agency_terms', 'billing_terms', 'pay_terms']) {
        await tx.execute(
          sql`delete from ${sql.identifier('public')}.${sql.identifier(table)} where assignment_id in ${assignments}`,
        );
      }
      await tx.execute(sql`delete from public.assignment where id in ${assignments}`);
      await tx.execute(sql`delete from public.person where full_name = ${dev}`);
      await tx.execute(sql`delete from public.contract where number = ${`AG-${tag}`}`);
      await tx.execute(sql`delete from public.client where legal_name = ${customer}`);
      await tx.execute(sql`delete from public.payee where legal_name_ua = ${agency}`);
    }),
  ),
);

test('A-068: an agency fee per hour becomes its own payout to the agency', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  const assignmentId = await withDb(async (db) => {
    const rows = await db.execute<{ id: string }>(
      sql`select a.id from public.assignment a join public.person p on p.id = a.person_id where p.full_name = ${dev}`,
    );
    return rows[0]?.id ?? '';
  });
  await page.goto(`/people/assignments/${assignmentId}`);
  const form = page.locator('form', { has: page.locator('#agency-validFrom') });
  await form.locator('#agency-validFrom').fill('2044-01');
  await form.getByLabel('Agency (payee)').selectOption({ label: agency });
  await form.getByLabel('USD per hour').fill('4');
  await form.getByRole('button', { name: 'Add version' }).click();
  await expect(page.getByRole('row', { name: new RegExp(agency) })).toContainText('4.00');

  await page.goto('/periods');
  await page.getByLabel('Month').fill(MONTH);
  await page.getByRole('button', { name: 'Open period' }).click();
  await expect(page).toHaveURL(/\/periods\/[0-9a-f-]+$/);
  await page.getByLabel(`Hours: ${dev}, ${customer}`).fill('100');
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Hours saved')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Close period' }).click();
  await expect(page.getByText(/Payouts created: \d+/)).toBeVisible();

  await page.locator('a[href^="/payroll?period="]').click();
  const card = page.getByTestId('payroll-item').filter({ hasText: `${agency} · agency fee` });
  await expect(card).toContainText('400.00');
  await expect(card).toContainText(dev);
});
