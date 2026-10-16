import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-113: a fiat payout of a person without a recipient gets a FOP from its row, and its act;
// a FOP without a contract gets one with its act numbering in the same dialog.
const tag = unique('E2E PAYEE');
const ids = { company: '', period: '', person: '', payee: '', item: '' };

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
      sql`insert into public.period (month, work_hours) values ('2058-03-01', 176) returning id`,
    );
    ids.person = await one(sql`insert into public.person (full_name) values (${tag}) returning id`);
    const a = await one(
      sql`insert into public.assignment (person_id, is_internal, starts_on) values (${ids.person}, true, '2058-01-01') returning id`,
    );
    ids.payee = await one(
      sql`insert into public.payee (kind, legal_name_ua) values ('fop', ${`ФОП ${tag}`}) returning id`,
    );
    await d.execute(
      sql`insert into public.number_sequence (key, template) values (${`act:${tag} TAKEN`}, 'X{seq}')`,
    );
    ids.item = await one(
      sql`insert into public.payroll_item (period_id, person_id, payout_method) values (${ids.period}, ${ids.person}, 'fiat') returning id`,
    );
    await d.execute(
      sql`insert into public.payroll_line (payroll_item_id, assignment_id, amount, status, funding_source) values (${ids.item}, ${a}, 100, 'payable', 'company')`,
    );
    await d.execute(sql`select public.refresh_payroll_item(${ids.item})`);
    await d.execute(
      sql`update public.payroll_item set payout_fx_rate = 40, fx_source = 'manual', total_uah = 4000 where id = ${ids.item}`,
    );
    // The person got a default after the close (A-114): the dialog starts from it.
    await d.execute(
      sql`update public.person set default_payee_id = ${ids.payee} where id = ${ids.person}`,
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
      await tx.execute(sql`delete from public.supplier_act where payroll_item_id = ${ids.item}`);
      await tx.execute(sql`delete from public.payroll_line where payroll_item_id = ${ids.item}`);
      await tx.execute(sql`delete from public.payroll_item where id = ${ids.item}`);
      await tx.execute(sql`delete from public.period where id = ${ids.period}`);
      await tx.execute(
        sql`update public.person set default_payee_id = null where id = ${ids.person}`,
      );
      await tx.execute(sql`delete from public.contract where payee_id = ${ids.payee}`);
      await tx.execute(
        sql`delete from public.number_sequence where key in (${`act:${tag} TAKEN`}, ${`act:${tag}`})`,
      );
      await tx.execute(sql`delete from public.payee where id = ${ids.payee}`);
      await tx.execute(sql`delete from public.assignment where person_id = ${ids.person}`);
      await tx.execute(sql`delete from public.person where id = ${ids.person}`);
      await tx.execute(sql`delete from public.company where id = ${ids.company}`);
    });
  } finally {
    await client.end();
  }
});

test('a payout without a recipient gets a FOP and its act from the row', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto(`/payroll?period=${ids.period}`);
  const row = page.getByTestId('payroll-row').filter({ hasText: tag });
  await expect(row.getByRole('link', { name: 'Issue act' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Create act' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Recipient')).toHaveValue(ids.payee);
  // A refused save keeps the choice and what was typed.
  await dialog.getByLabel('Contract number').fill(`${tag} TAKEN`);
  await dialog.getByRole('button', { name: 'Save recipient' }).click();
  await expect(
    dialog.getByText('Act numbering for a contract with this number already exists'),
  ).toBeVisible();
  await expect(dialog.getByLabel('Recipient')).not.toHaveValue('');
  await dialog.getByLabel('Contract number').fill(tag);
  await expect(dialog.getByLabel('Act number', { exact: true })).toHaveValue(`${tag} - А{seq}`);
  await dialog.getByRole('button', { name: 'Save recipient' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText(`ФОП ${tag}`);
  await expect(row.getByRole('link', { name: 'Issue act' })).toBeVisible();
});
