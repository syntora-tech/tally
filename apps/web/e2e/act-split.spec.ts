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
let emptyPeriod = '';
const early = { assignments: [] as string[], period: '' };

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
  const name = unique('E2E Split');
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
    sql`insert into public.assignment (person_id, is_internal, starts_on) values (${ids.person}, true, '2052-01-01') returning id`,
  );
  ids.period = await one(
    sql`insert into public.period (month, work_hours) values ('2052-09-01', 176) returning id`,
  );
  ids.item = await one(
    sql`insert into public.payroll_item (period_id, person_id, payout_method, payee_id, total_usd, payout_fx_rate, fx_source, total_uah)
        values (${ids.period}, ${ids.person}, 'fiat', ${ids.payee}, 5000, 41.5, 'manual', 207500) returning id`,
  );
  await one(
    sql`insert into public.payroll_line (payroll_item_id, assignment_id, amount, status, funding_source)
        values (${ids.item}, ${ids.assignment}, 5000, 'payable', 'company') returning id`,
  );
  await one(sql`select public.refresh_payroll_item(${ids.item}) as id`);
  await one(
    sql`insert into public.supplier_act (contract_id, payee_id, payroll_item_id, type, act_date, period_from, period_to, amount_uah)
        values (${ids.contract}, ${ids.payee}, ${ids.item}, 'monthly', '2052-09-30', '2052-09-01', '2052-09-30', 207500) returning id`,
  );
  // A-089: the same person's month before the close, two pieces of work and one early act.
  for (const amount of ['4000', '1000']) {
    const id = await one(
      sql`insert into public.assignment (person_id, is_internal, starts_on, role_title)
          values (${ids.person}, true, '2052-01-01', ${amount === '4000' ? 'Boosty' : 'CTO'}) returning id`,
    );
    await one(
      sql`insert into public.pay_terms (assignment_id, valid_from, type, amount, release_policy)
          values (${id}, '2052-10-01', 'fixed', ${amount}, 'immediate') returning id`,
    );
    early.assignments.push(id);
  }
  await one(
    sql`update public.person set default_payee_id = ${ids.payee} where id = ${ids.person} returning id`,
  );
  early.period = await one(
    sql`insert into public.period (month, work_hours) values ('2052-10-01', 184) returning id`,
  );
  await one(
    sql`insert into public.supplier_act (contract_id, payee_id, type, act_date, period_from, period_to, amount_uah, fx_rate, fx_source)
        values (${ids.contract}, ${ids.payee}, 'monthly', '2052-10-31', '2052-10-01', '2052-10-31', 207500, 41.5, 'manual') returning id`,
  );
  emptyPeriod = await one(
    sql`insert into public.period (month, work_hours) values ('2052-11-01', 168) returning id`,
  );
});

test.afterAll(async () => {
  const { db: d, sql: client } = db();
  try {
    await d.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${ids.payee}`);
      await tx.execute(sql`delete from public.payroll_line where payroll_item_id = ${ids.item}`);
      await tx.execute(sql`delete from public.payroll_item where id = ${ids.item}`);
    });
    await d.execute(
      sql`delete from public.period where id in (${ids.period}, ${emptyPeriod}, ${early.period})`,
    );
    for (const id of [ids.assignment, ...early.assignments]) {
      await d.execute(sql`delete from public.pay_terms where assignment_id = ${id}`);
      await d.execute(sql`delete from public.assignment where id = ${id}`);
    }
    await d.execute(sql`update public.person set default_payee_id = null where id = ${ids.person}`);
    await d.execute(sql`delete from public.contract where id = ${ids.contract}`);
    await d.execute(sql`delete from public.payee where id = ${ids.payee}`);
    await d.execute(sql`delete from public.person where id = ${ids.person}`);
    await d.execute(sql`delete from public.company where id = ${ids.company}`);
  } finally {
    await client.end();
  }
});

test('a single-activity act is split by a USD share at a boundary day (A-086)', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/payroll?period=${ids.period}`);
  await page.getByRole('button', { name: 'Split act' }).click();
  await expect(page.getByLabel('First act up to')).toHaveValue('2052-09-15');
  await page.getByLabel('USD for the new act').fill('4000');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByText('Act split')).toBeVisible();
  const acts = page.getByTestId('payout-acts');
  await expect(acts.getByText('01.09.2052–15.09.2052')).toBeVisible();
  await expect(acts.getByText('16.09.2052–30.09.2052')).toBeVisible();
  await expect(acts.getByText('166,000.00')).toBeVisible();
  await expect(acts.getByText('41,500.00')).toBeVisible();
});

test('an empty period opened by mistake is deleted', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/periods/${emptyPeriod}`);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Delete period' }).click();
  await expect(page).toHaveURL(/\/periods$/);
  // The period with payouts has no delete button.
  await page.goto(`/periods/${ids.period}`);
  await expect(page.getByRole('button', { name: 'Delete period' })).toHaveCount(0);
});

test('an act is split by work in an open period (A-089)', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/periods/${early.period}`);
  await page.getByRole('button', { name: 'Split act' }).click();
  await page.getByRole('checkbox', { name: /Boosty/ }).check();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByText('Act split')).toBeVisible();
  await expect(page.getByText('166,000.00')).toBeVisible();
  await expect(page.getByText('41,500.00')).toBeVisible();
  await expect(page.getByText(/01\.10\.2052–16\.10\.2052 · internal · Boosty/)).toBeVisible();
});
