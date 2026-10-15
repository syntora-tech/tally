import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const db = () =>
  createDb(localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
    max: 1,
  });
const ids = { company: '', person: '', payee: '', contract: '', period: '', item: '' };
const fop = { payee: '', contract: '', act: '' };

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
  const name = unique('E2E CV2 Contractor');
  ids.company = await one(
    sql`insert into public.company (name_en, name_ua) values (${name}, ${name}) returning id`,
  );
  ids.person = await one(sql`insert into public.person (full_name) values (${name}) returning id`);
  ids.payee = await one(
    sql`insert into public.payee (kind, legal_name_en, tax_id, address_en, bank_details_en, person_id)
        values ('other', ${name}, '(Canada) 961-358-652', 'London, ON', 'SWIFT: CIBCCATT', ${ids.person}) returning id`,
  );
  ids.contract = await one(
    sql`insert into public.contract (kind, number, signed_on, company_id, payee_id)
        values ('fop', '1005', '2025-10-28', ${ids.company}, ${ids.payee}) returning id`,
  );
  ids.period = await one(
    sql`insert into public.period (month, work_hours, status) values ('2052-09-01', 176, 'closed') returning id`,
  );
  ids.item = await one(
    sql`insert into public.payroll_item (period_id, person_id, payout_method, payee_id, total_usd)
        values (${ids.period}, ${ids.person}, 'bank_usd', ${ids.payee}, 3000) returning id`,
  );
  fop.payee = await one(
    sql`insert into public.payee (kind, legal_name_ua) values ('fop', ${`ФОП ${name}`}) returning id`,
  );
  fop.contract = await one(
    sql`insert into public.contract (kind, number, company_id, payee_id)
        values ('fop', ${name}, ${ids.company}, ${fop.payee}) returning id`,
  );
  fop.act = await one(
    sql`insert into public.supplier_act (contract_id, payee_id, type, act_date, period_from, period_to, amount_uah)
        values (${fop.contract}, ${fop.payee}, 'other', '2053-09-30', '2053-09-01', '2053-09-30', 100) returning id`,
  );
});

test.afterAll(async () => {
  const { db: d, sql: client } = db();
  try {
    await d.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.contractor_invoice where payee_id = ${ids.payee}`);
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${fop.payee}`);
      await tx.execute(sql`delete from public.payroll_item where id = ${ids.item}`);
    });
    await d.execute(sql`delete from public.period where id = ${ids.period}`);
    await d.execute(
      sql`delete from public.document where id in (select document_id from public.document_link where entity_type = 'payee' and entity_id = ${ids.payee})`,
    );
    await d.execute(
      sql`delete from public.contract where id in (${ids.contract}, ${fop.contract})`,
    );
    await d.execute(sql`delete from public.payee where id in (${ids.payee}, ${fop.payee})`);
    await d.execute(sql`delete from public.person where id = ${ids.person}`);
    await d.execute(sql`delete from public.company where id = ${ids.company}`);
  } finally {
    await client.end();
  }
});

// v2 contractor invoice (A-104): the draft is issued from its panel, regeneration sits under ⋯.
test('v2 contractor invoice: issued from its panel, the PDF regenerated from ⋯', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto(`/payroll?period=${ids.period}`);
  await page.getByRole('button', { name: 'Prepare the invoice' }).first().click();
  await expect(page).toHaveURL(/\/payroll\/contractor-invoices\//);
  await expect(page.getByTestId('contractor-invoice-amount')).toContainText('3,000.00');
  await page.getByLabel('Invoice date').fill('2052-10-13');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.getByRole('button', { name: 'Issue the invoice' }).click();
  await expect(
    page.getByRole('heading', { name: /Contractor invoice No\. 13102052/ }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the invoice document' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Regenerate PDF…' }).click();
  await page.getByRole('dialog').getByLabel('Reason for regenerating').fill('New layout');
  await page.getByRole('dialog').getByRole('button', { name: 'Regenerate PDF' }).click();
  await expect(page.getByText('PDF queued for regeneration')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
