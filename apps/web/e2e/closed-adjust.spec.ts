import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const db = () =>
  createDb(localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
    max: 1,
  });
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  assignment: '',
  period: '',
  item: '',
};

async function one(query: ReturnType<typeof sql>) {
  const { db: d, sql: client } = db();
  try {
    const rows = await d.execute<{ id: string }>(query);
    return [...rows][0]?.id ?? '';
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  const name = unique('E2E Adjust');
  ids.company = await one(
    sql`insert into public.company (name_en, name_ua) values (${name}, ${name}) returning id`,
  );
  ids.person = await one(sql`insert into public.person (full_name) values (${name}) returning id`);
  ids.payee = await one(
    sql`insert into public.payee (kind, legal_name_ua, person_id) values ('fop', ${`ФОП ${name}`}, ${ids.person}) returning id`,
  );
  ids.contract = await one(
    sql`insert into public.contract (kind, number, company_id, payee_id) values ('fop', ${name}, ${ids.company}, ${ids.payee}) returning id`,
  );
  ids.assignment = await one(
    sql`insert into public.assignment (person_id, is_internal, starts_on, role_title) values (${ids.person}, true, '2053-01-01', 'CTO') returning id`,
  );
  ids.period = await one(
    sql`insert into public.period (month, work_hours, status) values ('2053-09-01', 176, 'closed') returning id`,
  );
  ids.item = await one(
    sql`insert into public.payroll_item (period_id, person_id, payout_method, payee_id, total_usd, payout_fx_rate, fx_source, total_uah)
        values (${ids.period}, ${ids.person}, 'fiat', ${ids.payee}, 804, 44.73, 'manual', 35962.92) returning id`,
  );
  await one(
    sql`insert into public.payroll_line (payroll_item_id, assignment_id, amount, status, funding_source)
        values (${ids.item}, ${ids.assignment}, 804, 'payable', 'company') returning id`,
  );
  await one(sql`select public.refresh_payroll_item(${ids.item}) as id`);
  await one(
    sql`insert into public.supplier_act (contract_id, payee_id, payroll_item_id, type, act_date, period_from, period_to, amount_uah)
        values (${ids.contract}, ${ids.payee}, ${ids.item}, 'monthly', '2053-09-30', '2053-09-01', '2053-09-30', 35962.92) returning id`,
  );
});

test.afterAll(async () => {
  const { db: d, sql: client } = db();
  try {
    await d.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${ids.payee}`);
      await tx.execute(sql`delete from public.adjustment where period_id = ${ids.period}`);
      await tx.execute(sql`delete from public.payroll_line where payroll_item_id = ${ids.item}`);
      await tx.execute(sql`delete from public.payroll_item where id = ${ids.item}`);
    });
    await d.execute(sql`delete from public.period where id = ${ids.period}`);
    await d.execute(sql`delete from public.assignment where id = ${ids.assignment}`);
    await d.execute(sql`delete from public.contract where id = ${ids.contract}`);
    await d.execute(sql`delete from public.payee where id = ${ids.payee}`);
    await d.execute(sql`delete from public.person where id = ${ids.person}`);
    await d.execute(sql`delete from public.company where id = ${ids.company}`);
  } finally {
    await client.end();
  }
});

test('the owner corrects an unpaid payout of a closed month (A-099)', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/payroll?period=${ids.period}`);
  const card = page.getByTestId('payroll-item');
  await card.getByText('Adjustment after the close').click();
  await card.getByLabel('Amount, e.g. -0.27').fill('-0.27');
  await card.getByLabel('Reason', { exact: true }).fill('CTO is 803.73 USD');
  await card.getByRole('button', { name: 'Add adjustment' }).click();
  await expect(card.getByText(/-0\.27.*CTO is 803\.73 USD/)).toBeVisible();
  await expect(card.getByText('803.73 USD').first()).toBeVisible();
  await expect(card.getByTestId('payout-acts').getByText('35,950.84')).toBeVisible();
});
