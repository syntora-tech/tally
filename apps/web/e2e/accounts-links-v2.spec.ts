import { createDb } from '@tally/db';
import { expect, test, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-106: accounts are ordered and hidden from their page; a Ledger expense is linked to the
// planned payment it paid straight from its row.
const base = unique('E2E ACC');
const accA = `${base} A`;
const accB = `${base} B`;
const plan = unique('E2E LINK plan');
const TODAY = '2031-05-12';
let before: { id: string; position: number | null }[] = [];

function db() {
  return createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
}

test.beforeAll(async () => {
  const { db: d, sql: client } = db();
  try {
    before = (await d.execute(sql`select id, position from public.account`)) as unknown as {
      id: string;
      position: number | null;
    }[];
    await d.execute(sql`
      insert into public.account (name, kind, currency, opening_date, opening_balance)
      values (${accA}, 'bank', 'USD', '2031-01-01', 100), (${accB}, 'bank', 'USD', '2031-01-01', 100)`);
  } finally {
    await client.end();
  }
});

test.afterAll(async () => {
  const { db: d, sql: client } = db();
  try {
    await d.execute(sql`
      delete from public.transaction where id in (select p.transaction_id from public.posting p
        join public.account a on a.id = p.account_id where a.name in (${accA}, ${accB}))`);
    await d.execute(sql`
      delete from public.planned_payment where planned_expense_id in
        (select id from public.planned_expense where name = ${plan})`);
    await d.execute(sql`delete from public.planned_expense where name = ${plan}`);
    await d.execute(sql`delete from public.account where name in (${accA}, ${accB})`);
    for (const r of before) {
      await d.execute(sql`update public.account set position = ${r.position} where id = ${r.id}`);
    }
  } finally {
    await client.end();
  }
});

async function v2(page: Page) {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.context().addCookies([
    { name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' },
    { name: 'tally_today', value: TODAY, url: 'http://localhost:3000' },
  ]);
}

test('accounts are reordered and hidden from their page', async ({ page }) => {
  await v2(page);
  await page.goto('/ledger/accounts');
  const at = async (name: string) =>
    (await page.getByTestId('account-row').allTextContents()).findIndex((r) => r.includes(name));
  expect(await at(accB)).toBe((await at(accA)) + 1);

  await page.getByRole('button', { name: `Move ${accB} up` }).click();
  await expect.poll(async () => (await at(accB)) + 1 === (await at(accA))).toBe(true);

  await page.getByRole('button', { name: `Hide ${accA}` }).click();
  const rowA = page.getByTestId('account-row').filter({ hasText: accA });
  await expect(rowA).toContainText('Hidden');
  await expect(page.getByRole('button', { name: `Show ${accA}` })).toBeVisible();

  await page.goto('/ledger/new');
  const options = await page.locator('#from-account option').allTextContents();
  expect(options.some((o) => o.includes(accB))).toBe(true);
  expect(options.some((o) => o.includes(accA))).toBe(false);

  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: accB, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: accA, exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /hidden account/ })).toBeVisible();
});

test('a Ledger expense is linked to its planned payment from the row', async ({ page }) => {
  await v2(page);
  await page.goto('/ledger/planned?tab=plans');
  await page.getByRole('button', { name: '+ Planned expense' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#pe-new-name').fill(plan);
  await dialog.locator('#pe-new-category').selectOption({ label: 'Software / Tools' });
  await dialog.locator('#pe-new-amount').fill('40');
  await dialog.locator('#pe-new-currency').fill('USD');
  await dialog.locator('#pe-new-day').fill('12');
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(dialog).toHaveCount(0);

  const { db: d, sql: client } = db();
  try {
    await d.execute(sql`
      with t as (
        insert into public.transaction (occurred_on, type, category_id, description)
        select ${TODAY}, 'expense', id, ${plan} from public.category
          where tx_type = 'expense' and name = 'Software / Tools'
        returning id)
      insert into public.posting (transaction_id, account_id, amount, currency)
      select t.id, a.id, -40, 'USD' from t, public.account a where a.name = ${accB}`);
  } finally {
    await client.end();
  }

  await page.goto('/ledger');
  const row = page.getByTestId('ledger-row').filter({ hasText: plan });
  await expect(row.getByTestId('allocation')).toContainText('Not allocated');
  await row.getByTestId('link-transaction').click();
  const link = page.getByRole('dialog');
  await expect(link.getByText('Free to link: 40.00')).toBeVisible();
  await link.getByRole('radio', { name: new RegExp(plan) }).check();
  await link.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(link).toHaveCount(0);
  await expect(row.getByTestId('allocation')).toContainText('Allocated');

  await page.goto('/ledger/planned');
  await expect(page.getByTestId('planned-payment').filter({ hasText: plan }).first()).toContainText(
    'Paid',
  );
});

test.describe('linking to an invoice and a payout', () => {
  const party = unique('E2E LINK party');
  const ids = {
    company: '',
    client: '',
    contract: '',
    invoice: '',
    invoice2: '',
    person: '',
    period: '',
  };

  test.beforeAll(async () => {
    const { db: d, sql: client } = db();
    try {
      const [row] = (await d.execute(sql`
        with co as (insert into public.company (name_en, name_ua) values ('E2E L', 'E2E Л') returning id),
        cl as (insert into public.client (legal_name) values (${party}) returning id),
        ct as (insert into public.contract (kind, number, company_id, client_id)
          select 'client', ${party}, co.id, cl.id from co, cl returning id, client_id),
        inv as (insert into public.invoice (client_id, contract_id, issue_date, due_date, total, is_legacy)
          select client_id, id, '2031-05-01', '2031-05-20', 300, true from ct returning id),
        pe as (insert into public.person (full_name) values (${party}) returning id),
        pr as (insert into public.period (month, work_hours) values ('2031-04-01', 160) returning id)
        select (select id from co) company, (select id from cl) client, (select id from ct) contract,
          (select id from inv) invoice, (select id from pe) person, (select id from pr) period`)) as unknown as {
        company: string;
        client: string;
        contract: string;
        invoice: string;
        person: string;
        period: string;
      }[];
      Object.assign(ids, row);
      await d.execute(sql`
        insert into public.invoice_line (invoice_id, position, description_en, description_ua, quantity, unit_price, amount)
        values (${ids.invoice}, 1, 'Dev', 'Розробка', 1, 300, 300)`);
      await d.execute(
        sql`update public.invoice set status = 'issued', number = ${party} where id = ${ids.invoice}`,
      );
      const [second] = (await d.execute(sql`
        insert into public.invoice (client_id, contract_id, issue_date, due_date, total, is_legacy)
        values (${ids.client}, ${ids.contract}, '2031-05-02', '2031-05-21', 100, true)
        returning id`)) as unknown as { id: string }[];
      ids.invoice2 = second?.id ?? '';
      await d.execute(sql`
        insert into public.invoice_line (invoice_id, position, description_en, description_ua, quantity, unit_price, amount)
        values (${ids.invoice2}, 1, 'Dev', 'Розробка', 1, 100, 100)`);
      await d.execute(
        sql`update public.invoice set status = 'issued', number = ${`${party}-2`} where id = ${ids.invoice2}`,
      );
      await d.execute(sql`
        with a as (insert into public.assignment (person_id, is_internal, starts_on)
          values (${ids.person}, true, '2031-01-01') returning id),
        i as (insert into public.payroll_item (period_id, person_id, payout_method, total_usd)
          values (${ids.period}, ${ids.person}, 'bank_usd', 250) returning id)
        insert into public.payroll_line (payroll_item_id, assignment_id, amount, status, funding_source)
        select i.id, a.id, 250, 'payable', 'company' from i, a`);
      await d.execute(sql`
        select public.refresh_payroll_item(id) from public.payroll_item where period_id = ${ids.period}`);
      for (const [type, cat, amount, desc] of [
        ['revenue', 'Client Revenue', 400, `${party} receipt`],
        ['expense', 'Contractors', -250, `${party} payout`],
      ] as const) {
        await d.execute(sql`
          with t as (
            insert into public.transaction (occurred_on, type, category_id, description, client_id, person_id)
            select ${TODAY}, ${type}, c.id, ${desc},
              ${type === 'revenue' ? ids.client : null}::uuid, ${type === 'expense' ? ids.person : null}::uuid
            from public.category c where c.tx_type = ${type} and c.name = ${cat}
            returning id)
          insert into public.posting (transaction_id, account_id, amount, currency)
          select t.id, a.id, ${amount}, 'USD' from t, public.account a where a.name = ${accB}`);
      }
    } finally {
      await client.end();
    }
  });

  test.afterAll(async () => {
    const { db: d, sql: client } = db();
    try {
      await d.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`delete from public.allocation where transaction_id in
          (select id from public.transaction where description like ${`${party}%`})`);
        await tx.execute(sql`delete from public.payroll_line where payroll_item_id in
          (select id from public.payroll_item where period_id = ${ids.period})`);
        await tx.execute(sql`delete from public.payroll_item where period_id = ${ids.period}`);
        await tx.execute(
          sql`delete from public.invoice_line where invoice_id in (${ids.invoice}, ${ids.invoice2})`,
        );
        await tx.execute(
          sql`delete from public.invoice where id in (${ids.invoice}, ${ids.invoice2})`,
        );
      });
      await d.execute(sql`delete from public.transaction where description like ${`${party}%`}`);
      await d.execute(sql`delete from public.period where id = ${ids.period}`);
      await d.execute(sql`delete from public.assignment where person_id = ${ids.person}`);
      await d.execute(sql`delete from public.person where id = ${ids.person}`);
      await d.execute(sql`delete from public.contract where id = ${ids.contract}`);
      await d.execute(sql`delete from public.client where id = ${ids.client}`);
      await d.execute(sql`delete from public.company where id = ${ids.company}`);
    } finally {
      await client.end();
    }
  });

  test('one receipt pays two client invoices from the Ledger row', async ({ page }) => {
    await v2(page);
    await page.goto('/ledger');
    const row = page.getByTestId('ledger-row').filter({ hasText: `${party} receipt` });
    await row.getByTestId('link-transaction').click();
    const link = page.getByRole('dialog');
    await expect(link.getByText('Same party').first()).toBeVisible();
    await link.getByRole('checkbox', { name: new RegExp(`· ${party}\\s*\\d`) }).check();
    await link.getByRole('checkbox', { name: new RegExp(`· ${party}-2\\s*\\d`) }).check();
    await expect(link.getByLabel(`Amount for ${party} · ${party}`, { exact: true })).toHaveValue(
      '300.00',
    );
    await expect(link.getByLabel(`Amount for ${party} · ${party}-2`)).toHaveValue('100.00');
    await expect(link.getByTestId('split-total')).toContainText('400.00');
    await link.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(link).toHaveCount(0);
    await expect(row.getByTestId('allocation')).toContainText('Allocated');
    for (const id of [ids.invoice, ids.invoice2]) {
      await page.goto(`/invoices/${id}`);
      await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
    }
  });

  test('a payout expense opens its pay dialog with the transaction chosen', async ({ page }) => {
    await v2(page);
    await page.goto('/ledger');
    const row = page.getByTestId('ledger-row').filter({ hasText: `${party} payout` });
    await row.getByTestId('link-transaction').click();
    const link = page.getByRole('dialog');
    await link.getByRole('radio', { name: new RegExp(party) }).check();
    await link.getByRole('link', { name: 'Open the payout' }).click();
    await expect(page).toHaveURL(/\/payroll\?period=.*&pay=.*&tx=/);
    const pay = page.getByRole('dialog');
    await expect(pay.getByLabel('Transaction')).not.toHaveValue('');
    await pay.getByRole('button', { name: 'Close' }).click();
    await expect(page).not.toHaveURL(/pay=/);
  });
});
