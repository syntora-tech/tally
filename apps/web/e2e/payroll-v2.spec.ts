import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// v2 payroll (A-102) on a far-future month: one FOP payout waiting for its act, one payable
// crypto payout without a document, one line still waiting for the client.
const tag = unique('E2E V2P');
const names = { fop: `${tag} Fop`, pay: `${tag} Pay`, wait: `${tag} Wait` };
const account = `${tag} USD`;
const ids = {
  company: '',
  period: '',
  payee: '',
  contract: '',
  act: '',
  client: '',
  clientContract: '',
  invoice: '',
  persons: [] as string[],
  assignments: [] as string[],
  items: [] as string[],
};

async function one(query: ReturnType<typeof sql>) {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    const rows = await db.execute<{ id: string }>(query);
    return [...rows][0]?.id ?? '';
  } finally {
    await client.end();
  }
}

async function payout(
  name: string,
  method: string,
  amount: string,
  status: string,
  fundedBy: string | null = null,
) {
  const person = await one(
    sql`insert into public.person (full_name) values (${name}) returning id`,
  );
  const assignment = await one(
    sql`insert into public.assignment (person_id, is_internal, starts_on) values (${person}, true, '2053-01-01') returning id`,
  );
  const item = await one(
    sql`insert into public.payroll_item (period_id, person_id, payout_method, total_usd)
        values (${ids.period}, ${person}, ${method}, ${amount}) returning id`,
  );
  await one(
    sql`insert into public.payroll_line (payroll_item_id, assignment_id, amount, status, funding_source, funded_by_invoice_line_id)
        values (${item}, ${assignment}, ${amount}, ${status}, ${status === 'payable' ? 'client' : null}, ${fundedBy}) returning id`,
  );
  await one(sql`select public.refresh_payroll_item(${item}) as id`);
  ids.persons.push(person);
  ids.assignments.push(assignment);
  ids.items.push(item);
  return { person, item };
}

test.beforeAll(async () => {
  ids.company = await one(
    sql`insert into public.company (name_en, name_ua) values (${tag}, ${tag}) returning id`,
  );
  ids.period = await one(
    sql`insert into public.period (month, work_hours) values ('2053-03-01', 176) returning id`,
  );
  await one(
    sql`insert into public.account (name, kind, currency, opening_balance, opening_date)
        values (${account}, 'bank', 'USD', 0, '2053-01-01') returning id`,
  );
  const fop = await payout(names.fop, 'fiat', '2000', 'payable');
  ids.payee = await one(
    sql`insert into public.payee (kind, legal_name_ua, person_id) values ('fop', ${`ФОП ${names.fop}`}, ${fop.person}) returning id`,
  );
  ids.contract = await one(
    sql`insert into public.contract (kind, number, company_id, payee_id) values ('fop', ${tag}, ${ids.company}, ${ids.payee}) returning id`,
  );
  await one(
    sql`update public.payroll_item set payee_id = ${ids.payee}, payout_fx_rate = 41.5, fx_source = 'manual', total_uah = 83000
        where id = ${fop.item} returning id`,
  );
  ids.act = await one(
    sql`insert into public.supplier_act (contract_id, payee_id, payroll_item_id, type, act_date, period_from, period_to, amount_uah)
        values (${ids.contract}, ${ids.payee}, ${fop.item}, 'monthly', '2053-03-31', '2053-03-01', '2053-03-31', 83000) returning id`,
  );
  await payout(names.pay, 'crypto', '1000', 'payable');
  // The client's invoice is unpaid and due long after today, so the line keeps waiting.
  ids.client = await one(sql`insert into public.client (legal_name) values (${tag}) returning id`);
  ids.clientContract = await one(
    sql`insert into public.contract (kind, number, company_id, client_id) values ('client', ${`${tag} C`}, ${ids.company}, ${ids.client}) returning id`,
  );
  ids.invoice = await one(
    sql`insert into public.invoice (client_id, contract_id, issue_date, due_date, total)
        values (${ids.client}, ${ids.clientContract}, '2053-04-01', '2053-04-20', 700) returning id`,
  );
  const line = await one(
    sql`insert into public.invoice_line (invoice_id, position, description_en, description_ua, quantity, unit_price, amount)
        values (${ids.invoice}, 1, 'Work', 'Робота', 1, 700, 700) returning id`,
  );
  await payout(names.wait, 'crypto', '700', 'awaiting_client', line);
});

test.afterAll(async () => {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`
        create temp table own_tx on commit drop as
        select distinct p.transaction_id as id from public.posting p
        join public.account a on a.id = p.account_id where a.name = ${account}`);
      await tx.execute(
        sql`delete from public.allocation where transaction_id in (select id from own_tx)`,
      );
      await tx.execute(
        sql`delete from public.posting where transaction_id in (select id from own_tx)`,
      );
      await tx.execute(sql`delete from public.transaction where id in (select id from own_tx)`);
      await tx.execute(sql`delete from public.account where name = ${account}`);
      await tx.execute(
        sql`delete from public.document_link where entity_id in (select id from public.supplier_act where payee_id = ${ids.payee})`,
      );
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${ids.payee}`);
      for (const item of ids.items) {
        await tx.execute(sql`delete from public.payroll_line where payroll_item_id = ${item}`);
        await tx.execute(sql`delete from public.payroll_item where id = ${item}`);
      }
      await tx.execute(sql`delete from public.invoice_line where invoice_id = ${ids.invoice}`);
      await tx.execute(sql`delete from public.invoice where id = ${ids.invoice}`);
      await tx.execute(sql`delete from public.contract where id = ${ids.clientContract}`);
      await tx.execute(sql`delete from public.client where id = ${ids.client}`);
      await tx.execute(sql`delete from public.period where id = ${ids.period}`);
      await tx.execute(sql`delete from public.contract where id = ${ids.contract}`);
      await tx.execute(sql`delete from public.payee where id = ${ids.payee}`);
      for (const id of ids.assignments) {
        await tx.execute(sql`delete from public.assignment where id = ${id}`);
      }
      for (const id of ids.persons) {
        await tx.execute(sql`delete from public.person where id = ${id}`);
      }
      await tx.execute(sql`delete from public.company where id = ${ids.company}`);
    });
  } finally {
    await client.end();
  }
});

async function openV2(page: Page, tab?: string) {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto(`/payroll?period=${ids.period}${tab ? `&tab=${tab}` : ''}`);
}

const rowOf = (page: Page, name: string) =>
  page.getByTestId('payroll-row').filter({ hasText: name });

test('v2 payroll: tabs by status, the next step and the details of a payout', async ({ page }) => {
  await openV2(page);
  const tabs = page.getByRole('navigation', { name: 'Payout status' });
  await expect(tabs.getByRole('link', { name: /To pay/ })).toHaveAttribute('aria-current', 'page');
  await expect(tabs.getByRole('link', { name: /To pay/ })).toContainText('2');
  await expect(tabs.getByRole('link', { name: /Waiting for client/ })).toContainText('1');
  await expect(page.getByTestId('payroll-total')).toContainText('83,000.00 UAH');
  await expect(page.getByTestId('payroll-total')).toContainText('1,000.00 USD');

  const fop = rowOf(page, names.fop);
  await expect(fop.getByRole('list', { name: 'Payout steps' })).toBeVisible();
  await expect(fop.getByRole('link', { name: 'Issue act' })).toHaveAttribute(
    'href',
    `/acts/${ids.act}`,
  );
  await fop.getByRole('button', { name: `Details of ${names.fop}` }).click();
  await expect(fop.getByTestId('payout-acts')).toContainText('01.03.2053–31.03.2053');
  await expect(fop.getByTestId('payout-acts')).toContainText('draft');
  await expect(fop.getByLabel('Payout rate USD→UAH')).toHaveValue('41.500000');
  // A-109: the UAH sum typed instead of the rate; the rate follows it.
  await fop.getByRole('radio', { name: 'UAH sum' }).click();
  await expect(fop.getByLabel('Payout sum, UAH')).toHaveValue('83000.00');
  await fop.getByLabel('Payout sum, UAH').fill('83 246.90');
  await fop.getByRole('button', { name: 'Approve rate' }).click();
  await expect(page.getByText('Rate 41.623450 approved')).toBeVisible();
  await expect(fop.getByLabel('Payout rate USD→UAH')).toHaveValue('41.623450');
  await expect(fop.getByTestId('payout-acts')).toContainText('83,246.90');

  // Rare actions live in the ⋯ menu; paying before the act is signed is one of them.
  await fop.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Pay now…' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Split act/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await page
    .getByRole('navigation', { name: 'Payout status' })
    .getByRole('link', { name: /Waiting/ })
    .click();
  await expect(page).toHaveURL(/tab=waiting/);
  await expect(rowOf(page, names.wait)).toBeVisible();
  await expect(rowOf(page, names.pay)).toHaveCount(0);
});

test('v2 payroll: a payout is paid from its dialog and moves to Paid', async ({ page }) => {
  await openV2(page);
  const row = rowOf(page, names.pay);
  await row.getByTestId('pay').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: `Pay: ${names.pay}` })).toBeVisible();
  const option = await dialog
    .locator('select[name=accountId] option', { hasText: account })
    .getAttribute('value');
  await dialog.locator('select[name=accountId]').selectOption(option ?? '');
  await expect(dialog.getByLabel('Amount, USD')).toHaveValue('1000.00');
  await dialog.getByRole('button', { name: 'Record payout' }).click();
  await expect(page.getByText('Payout recorded')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(rowOf(page, names.pay)).toHaveCount(0);

  await page.goto(`/payroll?period=${ids.period}&tab=paid`);
  await expect(rowOf(page, names.pay)).toContainText('Paid');
});

test('v2 payroll: the owner releases a waiting line from the line menu', async ({ page }) => {
  await openV2(page, 'waiting');
  const row = rowOf(page, names.wait);
  await row.getByRole('button', { name: `Details of ${names.wait}` }).click();
  await row.getByRole('button', { name: 'Line actions' }).click();
  await page.getByRole('menuitem', { name: 'Release the line…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Release reason').fill('Advance agreed');
  await dialog.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(page.getByText('Line released')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.goto(`/payroll?period=${ids.period}&tab=ready`);
  await expect(rowOf(page, names.wait)).toBeVisible();
});
