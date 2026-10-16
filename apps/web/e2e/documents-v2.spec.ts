import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 invoice and act pages (A-102): the main action in the header, rare ones in ⋯.
const tag = unique('E2E DV2');
const INVOICE_SEQ = 'e2e:inv-v2';
const ACT_SEQ = 'e2e:act-v2';
const ids = {
  company: '',
  client: '',
  contract: '',
  invoice: '',
  person: '',
  payee: '',
  fop: '',
  act: '',
};

async function run<T>(fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>) {
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
const one = (query: ReturnType<typeof sql>) =>
  run(async (db) => [...(await db.execute<{ id: string }>(query))][0]?.id ?? '');

test.beforeAll(async () => {
  await one(sql`insert into public.number_sequence (key, template) values
    (${INVOICE_SEQ}, 'DV{seq}/{yy}'), (${ACT_SEQ}, 'DV - А{seq}') on conflict (key) do nothing returning key as id`);
  ids.company = await one(
    sql`insert into public.company (name_en, name_ua) values (${tag}, ${tag}) returning id`,
  );
  ids.client = await one(sql`insert into public.client (legal_name) values (${tag}) returning id`);
  ids.contract = await one(
    sql`insert into public.contract (kind, number, company_id, client_id, number_sequence_key)
        values ('client', ${`${tag} C`}, ${ids.company}, ${ids.client}, ${INVOICE_SEQ}) returning id`,
  );
  ids.invoice = await one(
    sql`insert into public.invoice (client_id, contract_id, issue_date, due_date)
        values (${ids.client}, ${ids.contract}, '2054-02-02', '2054-02-20') returning id`,
  );
  await one(
    sql`insert into public.invoice_line (invoice_id, position, description_en, description_ua, quantity, unit_price, amount)
        values (${ids.invoice}, 1, 'Development', 'Розробка', 10, 50, 500) returning id`,
  );
  ids.person = await one(sql`insert into public.person (full_name) values (${tag}) returning id`);
  ids.payee = await one(
    sql`insert into public.payee (kind, legal_name_ua, person_id) values ('fop', ${`ФОП ${tag}`}, ${ids.person}) returning id`,
  );
  ids.fop = await one(
    sql`insert into public.contract (kind, number, company_id, payee_id, number_sequence_key)
        values ('fop', ${`${tag} F`}, ${ids.company}, ${ids.payee}, ${ACT_SEQ}) returning id`,
  );
  ids.act = await one(
    sql`insert into public.supplier_act (contract_id, payee_id, type, act_date, period_from, period_to, amount_uah)
        values (${ids.fop}, ${ids.payee}, 'other', '2054-02-27', '2054-02-01', '2054-02-27', 12000) returning id`,
  );
});

test.afterAll(() =>
  run((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.job where payload ->> 'invoiceId' = ${ids.invoice}
        or payload ->> 'actId' = ${ids.act}`);
      await tx.execute(sql`create temp table own_docs on commit drop as
        select document_id as id from public.document_link where entity_id in (${ids.invoice}, ${ids.act}, ${ids.client}, ${ids.payee})`);
      await tx.execute(
        sql`delete from public.document_link where document_id in (select id from own_docs)`,
      );
      await tx.execute(sql`delete from public.document where id in (select id from own_docs)`);
      await tx.execute(sql`delete from public.invoice_revision where invoice_id = ${ids.invoice}`);
      await tx.execute(sql`delete from public.invoice_line where invoice_id = ${ids.invoice}`);
      await tx.execute(sql`delete from public.invoice where contract_id = ${ids.contract}`);
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${ids.payee}`);
      await tx.execute(sql`delete from public.contract where id in (${ids.contract}, ${ids.fop})`);
      await tx.execute(sql`delete from public.payee where id = ${ids.payee}`);
      await tx.execute(sql`delete from public.person where id = ${ids.person}`);
      await tx.execute(sql`delete from public.client where id = ${ids.client}`);
      await tx.execute(sql`delete from public.company where id = ${ids.company}`);
      await tx.execute(
        sql`delete from public.number_sequence where key in (${INVOICE_SEQ}, ${ACT_SEQ})`,
      );
    }),
  ),
);

async function v2(page: Page) {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
}

test('v2 invoice: issued from its panel, changed and voided from ⋯', async ({ page }) => {
  await v2(page);
  await page.goto(`/invoices/${ids.invoice}`);
  await expect(page.getByTestId('invoice-status')).toHaveText('Draft');
  await page
    .getByTestId('issue-panel')
    .getByRole('button', { name: 'Issue and assign a number' })
    .click();
  await expect(page.getByRole('heading', { name: /Invoice No\. DV1\/54/ })).toBeVisible();
  await expect(page.getByTestId('invoice-status')).toHaveText('Issued');
  await expect(page.getByTestId('invoice-total')).toHaveText('500.00 USD');
  await expect(page.getByTestId('allocate')).toBeVisible();

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Change (new revision)…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Quantity').fill('12');
  await dialog.getByLabel('Reason for the change').fill('More hours');
  await dialog.getByRole('button', { name: 'Save new revision' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('invoice-total')).toHaveText('600.00 USD');
  await expect(page.getByText('More hours')).toBeVisible();

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Void…' }).click();
  await page.getByRole('dialog').getByLabel('Void reason').fill('Wrong client');
  await page.getByRole('dialog').getByRole('button', { name: 'Void' }).click();
  await expect(page.getByTestId('invoice-status')).toHaveText('Void');

  await page.goto('/invoices');
  const tabs = page.getByRole('navigation', { name: 'Filter by status' });
  await tabs.getByRole('link', { name: /Void/ }).click();
  await expect(page).toHaveURL(/status=void/);
  await expect(page.getByRole('row', { name: /DV1\/54/ })).toBeVisible();
});

test('v2 act: generate or my own PDF, then the signing step', async ({ page }) => {
  await v2(page);
  await page.goto(`/acts/${ids.act}`);
  await expect(page.getByTestId('act-status')).toHaveText('Draft');
  const steps = page.getByRole('list', { name: 'Payout steps' });
  await expect(steps.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');

  await page.getByRole('link', { name: 'My own PDF' }).click();
  await expect(page.getByLabel('Act PDF')).toBeVisible();
  await page.getByRole('link', { name: 'Generate' }).click();
  // A-107: the number it would get now, and its period changed in the draft.
  await expect(page.getByTestId('act-next-number')).toContainText('Will be issued as № DV - А1');
  await page.getByLabel('Period from').fill('2054-01-10');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Period from')).toHaveValue('2054-01-10');
  // A-112: what is typed but not saved goes into the act on issue.
  await page.getByLabel('Period to').fill('2054-01-28');
  await page.getByRole('button', { name: 'Issue the act and assign a number' }).click();
  await expect(page.getByRole('heading', { name: /Act No\. DV - А1/ })).toBeVisible();
  await expect(page.getByTestId('act-status')).toHaveText('Active');
  await expect(steps.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByLabel('Signed act in Vchasno')).toBeVisible();

  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Void…' })).toBeVisible();

  // An issued, unsigned act gets new dates under its number (A-112).
  await page.getByRole('menuitem', { name: 'Change dates…' }).click();
  const revise = page.getByRole('dialog');
  await expect(revise.getByLabel('Period to')).toHaveValue('2054-01-28');
  await revise.getByLabel('Period from').fill('2054-01-12');
  await revise.getByLabel('Why change').fill('Agreed with the FOP');
  await revise.getByRole('button', { name: 'Change dates' }).click();
  await expect(page.getByText('Act changed; a new PDF is being made')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Act No\. DV - А1/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Change dates…' }).click();
  await expect(page.getByRole('dialog').getByLabel('Period from')).toHaveValue('2054-01-12');
});
