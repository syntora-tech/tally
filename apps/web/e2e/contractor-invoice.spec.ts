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
  const name = unique('E2E Contractor');
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
        values ('fop', '1004', '2025-10-28', ${ids.company}, ${ids.payee}) returning id`,
  );
  ids.period = await one(
    sql`insert into public.period (month, work_hours, status) values ('2053-09-01', 176, 'closed') returning id`,
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

test('a contractor abroad gets an invoice drafted from the payout and issued (A-090)', async ({
  page,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/payroll?period=${ids.period}`);
  const block = page.getByTestId('contractor-invoice');
  await block.getByRole('button', { name: 'Prepare the invoice' }).click();
  await expect(page).toHaveURL(/\/payroll\/contractor-invoices\//);
  await expect(page.getByTestId('contractor-invoice-amount')).toContainText('3,000.00');
  await page.getByLabel('Invoice date').fill('2053-10-13');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.getByRole('button', { name: 'Issue the invoice' }).click();
  await expect(
    page.getByRole('heading', { name: /Contractor invoice No\. 13102053/ }),
  ).toBeVisible();
  // The page refreshes itself while the PDF is generated.
  await expect(page.getByRole('link', { name: 'Open the invoice document' })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel('Reason for regenerating').fill('New layout');
  await page.getByRole('button', { name: 'Regenerate PDF' }).click();
  await expect(page.getByText('PDF queued for regeneration')).toBeVisible();
  // A-093: the new PDF is the next version of the document, the old one is void.
  await expect(async () => {
    const { db: d, sql: client } = db();
    try {
      const docs = await d.execute<{ version: number; status: string }>(
        sql`select d.version, d.status from public.document d join public.document_link l on l.document_id = d.id
            where l.entity_type = 'payee' and l.entity_id = ${ids.payee} order by d.version`,
      );
      expect(docs.map((r) => `${String(r.version)}:${r.status}`)).toEqual(['1:void', '2:issued']);
    } finally {
      await client.end();
    }
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Open the invoice document' })).toBeVisible({
    timeout: 20_000,
  });
  await page.goto(`/payroll?period=${ids.period}`);
  await expect(page.getByTestId('contractor-invoice')).toContainText('13102053');
});

test('the owner deletes a draft act with a reason (A-091)', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto(`/acts/${fop.act}`);
  await page.getByLabel('Reason', { exact: true }).fill('Created by mistake');
  await page.getByRole('button', { name: 'Delete draft' }).click();
  await expect(page).toHaveURL(/\/acts$/);
  await page.goto(`/acts/${fop.act}`);
  await expect(page.getByText(/not found|404/i).first()).toBeVisible();
});
