import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-111: a payout whose paid part has its act and whose act of the rest was voided gets a new
// act of the rest from its row instead of a link to the act already issued.
const tag = unique('E2E REST');
const ids = { company: '', period: '', person: '', payee: '', contract: '', item: '' };

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
      sql`insert into public.company (name_en, name_ua) values (${tag}, ${tag}) returning id`,
    );
    ids.period = await one(
      sql`insert into public.period (month, work_hours) values ('2057-03-01', 176) returning id`,
    );
    ids.person = await one(sql`insert into public.person (full_name) values (${tag}) returning id`);
    const [a1, a2] = [
      await one(
        sql`insert into public.assignment (person_id, is_internal, starts_on) values (${ids.person}, true, '2057-01-01') returning id`,
      ),
      await one(
        sql`insert into public.assignment (person_id, is_internal, starts_on) values (${ids.person}, true, '2057-01-01') returning id`,
      ),
    ];
    ids.payee = await one(
      sql`insert into public.payee (kind, legal_name_ua, person_id) values ('fop', ${`ФОП ${tag}`}, ${ids.person}) returning id`,
    );
    ids.contract = await one(
      sql`insert into public.contract (kind, number, company_id, payee_id) values ('fop', ${tag}, ${ids.company}, ${ids.payee}) returning id`,
    );
    ids.item = await one(
      sql`insert into public.payroll_item (period_id, person_id, payout_method, payee_id) values (${ids.period}, ${ids.person}, 'fiat', ${ids.payee}) returning id`,
    );
    const act = await one(
      sql`insert into public.supplier_act (contract_id, payee_id, payroll_item_id, type, act_date, period_from, period_to, amount_uah, amount_usd, fx_rate, fx_source, rate_locked, is_legacy, status, number, signed_url)
          values (${ids.contract}, ${ids.payee}, ${ids.item}, 'monthly', '2057-03-31', '2057-03-01', '2057-03-31', 4473, 100, 44.73, 'manual', true, true, 'issued', ${tag}, 'https://example.com/a') returning id`,
    );
    await d.execute(
      sql`insert into public.payroll_line (payroll_item_id, assignment_id, amount, status, funding_source, supplier_act_id)
          values (${ids.item}, ${a1}, 100, 'payable', 'company', ${act}), (${ids.item}, ${a2}, 4000, 'payable', 'company', null)`,
    );
    await d.execute(sql`select public.refresh_payroll_item(${ids.item})`);
    await d.execute(
      sql`update public.payroll_item set payout_fx_rate = 44.73, fx_source = 'manual', total_uah = 183393 where id = ${ids.item}`,
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
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${ids.payee}`);
      await tx.execute(sql`delete from public.payroll_line where payroll_item_id = ${ids.item}`);
      await tx.execute(sql`delete from public.payroll_item where id = ${ids.item}`);
      await tx.execute(sql`delete from public.period where id = ${ids.period}`);
      await tx.execute(sql`delete from public.contract where id = ${ids.contract}`);
      await tx.execute(sql`delete from public.payee where id = ${ids.payee}`);
      await tx.execute(sql`delete from public.assignment where person_id = ${ids.person}`);
      await tx.execute(sql`delete from public.person where id = ${ids.person}`);
      await tx.execute(sql`delete from public.company where id = ${ids.company}`);
    });
  } finally {
    await client.end();
  }
});

test('a payout without an act of the rest gets one from its row', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto(`/payroll?period=${ids.period}`);
  const row = page.getByTestId('payroll-row').filter({ hasText: tag });
  await expect(row.getByRole('link', { name: 'Issue act' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Create act' }).click();
  await expect(row.getByRole('link', { name: 'Issue act' })).toBeVisible();
  await row.getByRole('button', { name: `Details of ${tag}` }).click();
  await expect(row.getByTestId('payout-acts')).toContainText('01.04.2057–01.04.2057');
  await expect(row.getByTestId('payout-acts')).toContainText('178,920.00');
});
