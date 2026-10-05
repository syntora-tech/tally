import { expect, test, type Page } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// Spec 9.4 on a 2043 calendar with the same shape: August period, invoice 01.09 (Tue), due 20.09
// (Sunday), payout deadline Monday 21.09. A far-future month keeps real 2026 data untouched.
const MONTH = '2043-08';
const INVOICE_SEQ = 'e2e:inv94';
const ACT_SEQ = 'e2e:act94';
const tag = unique('94');
const people = { p1: `On Time ${tag}`, p2: `Overdue ${tag}`, p3: `Partial ${tag}` };
const clients = { k1: `Client One ${tag}`, k2: `Client Two ${tag}`, k3: `Client Three ${tag}` };
const accounts = { usd: `E2E94 USD ${tag}`, uah: `E2E94 UAH ${tag}` };
const fop = `ФОП Е2Е ${tag}`;

const dbUrl = () =>
  localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function withDb<T>(fn: (db: ReturnType<typeof createDb>['db']) => Promise<T>) {
  const { db, sql: client } = createDb(dbUrl(), { max: 1 });
  try {
    return await fn(db);
  } finally {
    await client.end();
  }
}

async function setToday(page: Page, date: string) {
  await page
    .context()
    .addCookies([{ name: 'tally_today', value: date, url: 'http://localhost:3000' }]);
}

test.beforeAll(() =>
  withDb(async (db) => {
    await db.execute(sql`
      insert into public.company (name_en, name_ua)
      select 'E2E company', 'E2E компанія' where not exists (select 1 from public.company)
    `);
    await db.execute(sql`insert into public.number_sequence (key, template) values
      (${INVOICE_SEQ}, 'S{seq}/{yy}'), (${ACT_SEQ}, '94 - А{seq}') on conflict (key) do nothing`);
    await db.execute(sql`insert into public.account (name, kind, currency, opening_balance, opening_date) values
      (${accounts.usd}, 'bank', 'USD', 0, '2043-01-01'), (${accounts.uah}, 'bank', 'UAH', 0, '2043-01-01')`);
    for (const [key, name] of Object.entries(people)) {
      const k = key.replace('p', 'k') as keyof typeof clients;
      await db.execute(sql`
        with co as (select id from public.company order by created_at limit 1),
        cl as (insert into public.client (legal_name) values (${clients[k]}) returning id),
        ct as (
          insert into public.contract (kind, number, company_id, client_id, number_sequence_key)
          select 'client', ${`E2E94-${key}`}, co.id, cl.id, ${INVOICE_SEQ} from co, cl returning id
        ),
        p as (insert into public.person (full_name) values (${name}) returning id),
        a as (
          insert into public.assignment (person_id, contract_id, role_title, starts_on)
          select p.id, ct.id, 'Developer', '2043-01-01' from p, ct returning id
        ),
        b as (
          insert into public.billing_terms (assignment_id, valid_from, type, rate)
          select a.id, '2043-01-01', 'hourly', 47 from a
        )
        insert into public.pay_terms (assignment_id, valid_from, type, amount)
        select a.id, '2043-01-01', 'hourly', 3000 from a
      `);
    }
    // P1 is paid in UAH through a FOP whose monthly act follows the payout (scenario 1).
    await db.execute(sql`
      with co as (select id from public.company order by created_at limit 1),
      p as (select id from public.person where full_name = ${people.p1}),
      f as (insert into public.payee (kind, legal_name_ua, person_id) select 'fop', ${fop}, p.id from p returning id),
      u as (update public.person set default_payee_id = (select id from f) where id = (select id from p))
      insert into public.contract (kind, number, company_id, payee_id, number_sequence_key)
      select 'fop', ${`OD-94-${tag}`}, co.id, f.id, ${ACT_SEQ} from co, f
    `);
  }),
);

test.afterAll(() =>
  withDb((db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const like = `%${tag}`;
      await tx.execute(sql`
        delete from public.allocation a using public.transaction t, public.posting p, public.account ac
        where a.transaction_id = t.id and p.transaction_id = t.id and ac.id = p.account_id and ac.name like ${like}`);
      await tx.execute(sql`
        delete from public.transaction t using public.posting p, public.account ac
        where p.transaction_id = t.id and ac.id = p.account_id and ac.name like ${like}`);
      await tx.execute(
        sql`delete from public.posting p using public.account ac where ac.id = p.account_id and ac.name like ${like}`,
      );
      await tx.execute(sql`delete from public.account where name like ${like}`);
      await tx.execute(sql`
        delete from public.document d using public.document_link l, public.payee pe
        where l.document_id = d.id and l.entity_id = pe.id and pe.legal_name_ua = ${fop}`);
      await tx.execute(
        sql`delete from public.supplier_act s using public.payee pe where pe.id = s.payee_id and pe.legal_name_ua = ${fop}`,
      );
      const periodIds = sql`(select id from public.period where month = ${`${MONTH}-01`})`;
      await tx.execute(
        sql`delete from public.payroll_line where payroll_item_id in (select id from public.payroll_item where period_id in ${periodIds})`,
      );
      await tx.execute(sql`delete from public.payroll_item where period_id in ${periodIds}`);
      await tx.execute(
        sql`delete from public.job where payload ->> 'invoiceId' in (select id::text from public.invoice where period_id in ${periodIds})`,
      );
      await tx.execute(sql`
        delete from public.document d using public.document_link l, public.invoice i
        where l.document_id = d.id and l.entity_id = i.id and i.period_id in ${periodIds}`);
      await tx.execute(
        sql`delete from public.invoice_line where invoice_id in (select id from public.invoice where period_id in ${periodIds})`,
      );
      await tx.execute(
        sql`delete from public.invoice_revision where invoice_id in (select id from public.invoice where period_id in ${periodIds})`,
      );
      await tx.execute(sql`delete from public.invoice where period_id in ${periodIds}`);
      await tx.execute(sql`delete from public.timesheet where period_id in ${periodIds}`);
      await tx.execute(sql`delete from public.period where month = ${`${MONTH}-01`}`);
      await tx.execute(
        sql`delete from public.contract where number like ${`%${tag}`} or number like 'E2E94-%'`,
      );
      await tx.execute(
        sql`update public.person set default_payee_id = null where full_name like ${like}`,
      );
      await tx.execute(sql`delete from public.payee where legal_name_ua = ${fop}`);
      await tx.execute(
        sql`delete from public.billing_terms b using public.assignment a, public.person p where b.assignment_id = a.id and a.person_id = p.id and p.full_name like ${like}`,
      );
      await tx.execute(
        sql`delete from public.pay_terms b using public.assignment a, public.person p where b.assignment_id = a.id and a.person_id = p.id and p.full_name like ${like}`,
      );
      await tx.execute(
        sql`delete from public.assignment a using public.person p where a.person_id = p.id and p.full_name like ${like}`,
      );
      await tx.execute(sql`delete from public.person where full_name like ${like}`);
      await tx.execute(sql`delete from public.client where legal_name like ${like}`);
      await tx.execute(
        sql`delete from public.number_sequence where key in (${INVOICE_SEQ}, ${ACT_SEQ})`,
      );
    }),
  ),
);

async function revenue(page: Page, amount: string) {
  await page.goto('/ledger/new');
  await page.getByLabel('Type').selectOption('revenue');
  await page.getByLabel('Category').selectOption({ label: 'Client Revenue' });
  await page.locator('#to-account').selectOption({ label: `${accounts.usd} (USD)` });
  await page.locator('#to-amount').fill(amount);
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
}

async function openInvoice(page: Page, client: string) {
  await page.goto('/invoices');
  await page.getByRole('cell', { name: client }).first().click();
  await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
}

async function allocate(page: Page, client: string, amount: string) {
  await openInvoice(page, client);
  const option = await page
    .locator('#pay-tx option', { hasText: accounts.usd })
    .first()
    .getAttribute('value');
  await page.locator('#pay-tx').selectOption(option ?? '');
  await page.locator('#pay-amount').fill(amount);
  await page.getByRole('button', { name: 'Allocate payment' }).click();
  await expect(page.getByText('Payment allocated')).toBeVisible();
}

const itemCard = (page: Page, person: string) =>
  page.getByTestId('payroll-item').filter({ hasText: person });

test('spec 9.4: pay-when-paid scenarios 1–5', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, E2E_OWNER_EMAIL);

  // Common: close August, issue the three invoices on 01.09.
  await setToday(page, '2043-09-01');
  await page.goto('/periods');
  await page.getByLabel('Month').fill(MONTH);
  await page.getByRole('button', { name: 'Open period' }).click();
  await expect(page).toHaveURL(/\/periods\/[0-9a-f-]+$/);
  for (const [key, person] of Object.entries(people)) {
    const client = clients[key.replace('p', 'k') as keyof typeof clients];
    await page.getByLabel(`Hours: ${person}, ${client}`).fill('10');
  }
  await page.getByRole('button', { name: 'Save hours' }).click();
  await expect(page.getByText('Hours saved')).toBeVisible();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Close period' }).click();
  await expect(page.getByText(/Payouts created: \d+/)).toBeVisible();
  const periodUrl = page.url();
  for (const client of Object.values(clients)) {
    await page.goto(periodUrl);
    await page.getByRole('link', { name: `${client} — draft` }).click();
    await expect(page.getByLabel('Issue date')).toHaveValue('2043-09-01');
    await page.getByRole('button', { name: 'Issue and assign a number' }).click();
    await expect(page.getByRole('heading', { name: /Invoice No\. S\d+\/43/ })).toBeVisible();
  }

  // 1. Client pays on time (17.09) → line payable funded by the client → payout at the Ledger rate → act.
  await setToday(page, '2043-09-17');
  await revenue(page, '470');
  await allocate(page, clients.k1, '470');
  await page.goto('/ledger/new');
  await page.getByLabel('Type').selectOption('fx_exchange');
  await page.locator('#from-account').selectOption({ label: `${accounts.usd} (USD)` });
  await page.locator('#from-amount').fill('300');
  await page.locator('#to-account').selectOption({ label: `${accounts.uah} (UAH)` });
  await page.locator('#to-amount').fill('12315');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page).toHaveURL(/\/ledger$/);

  await page.goto('/payroll');
  const p1 = itemCard(page, people.p1);
  await expect(p1).toContainText('client');
  await p1.getByRole('button', { name: 'Pay' }).click();
  await expect(p1.getByText('actual exchange')).toBeVisible();
  await expect(p1.getByLabel('USD→UAH rate')).toHaveValue('41.050000');
  const uahOption = await p1
    .locator('select[name=accountId] option', { hasText: accounts.uah })
    .getAttribute('value');
  await p1.locator('select[name=accountId]').selectOption(uahOption ?? '');
  const payAmount = await p1.getByLabel('Amount, UAH').inputValue();
  await p1.getByRole('button', { name: 'Record payout' }).click();
  await expect(page.getByText('Payout recorded')).toBeVisible();

  await page.goto('/payroll/acts');
  await page
    .getByRole('row', { name: new RegExp(fop) })
    .getByRole('link', { name: 'draft' })
    .click();
  await expect(page.getByLabel('Act date')).toHaveValue('2043-08-31');
  await expect(page.getByTestId('act-amount')).toContainText(
    payAmount.replace(/\B(?=(\d{3})+(?!\d))/g, ','),
  );
  await page.getByRole('button', { name: 'Issue the act and assign a number' }).click();
  await expect(page.getByRole('heading', { name: /Act No\. 94 - А1/ })).toBeVisible();
  await page.reload();
  await expect(page.getByText('The act file is generated')).toBeVisible({ timeout: 15_000 });

  // 4. 50 % on 18.09 → the line waits until 21.09.
  await setToday(page, '2043-09-18');
  await revenue(page, '235');
  await allocate(page, clients.k3, '235');
  await page.goto('/payroll');
  await expect(itemCard(page, people.p3)).toContainText('waiting for client until 21.09.2043');

  // 2. Client is late: on 21.09 the line becomes payable at the company's expense.
  await setToday(page, '2043-09-21');
  await page.goto('/payroll');
  await expect(itemCard(page, people.p2)).toContainText('payable');
  await expect(itemCard(page, people.p2)).toContainText('company');
  await page.goto('/dashboard');
  const creditBefore = await page.getByTestId('credit-to-clients').innerText();
  expect(creditBefore).not.toMatch(/^0\.00/);
  await expect(page.getByTestId('payable-total')).not.toHaveText(/^0\.00/);
  await expect(page.getByTestId('forecast-month')).toHaveCount(6);

  // 3. Late payment on 25.09 → invoice paid, credit falls, funding stays with the company.
  await setToday(page, '2043-09-25');
  await revenue(page, '470');
  await allocate(page, clients.k2, '470');
  await expect(page.getByText('Paid').first()).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByTestId('credit-to-clients')).not.toHaveText(creditBefore);
  await page.goto('/payroll');
  await expect(itemCard(page, people.p2)).toContainText('company');

  // A payout already in the Ledger (a statement row) is linked to the item, not booked twice.
  await page.goto('/ledger/new');
  await page.getByLabel('Type').selectOption('expense');
  await page.getByLabel('Category').selectOption({ label: 'Contractors' });
  await page.locator('#from-account').selectOption({ label: `${accounts.uah} (UAH)` });
  await page.locator('#from-amount').fill('10000');
  await page.getByRole('button', { name: 'Save transaction' }).click();
  await expect(page).toHaveURL(/\/ledger$/);
  await page.goto('/payroll');
  const p2 = itemCard(page, people.p2);
  await p2.getByRole('button', { name: 'Pay' }).click();
  await p2.getByLabel('Payment', { exact: true }).selectOption('existing');
  await expect(p2.getByLabel('Paying account')).toHaveCount(0);
  const statementRow = await p2
    .locator('select[name=transactionId] option', { hasText: accounts.uah })
    .first()
    .getAttribute('value');
  await p2.locator('select[name=transactionId]').selectOption(statementRow ?? '');
  await expect(p2.getByLabel('Amount, UAH')).not.toHaveValue('10000.00');
  await p2.getByRole('button', { name: 'Record payout' }).click();
  await expect(page.getByText('Payout recorded')).toBeVisible();

  // 5. A paid invoice cannot be edited; void + reissue gives a new number and rebinds the funding.
  await openInvoice(page, clients.k1);
  await expect(page.getByText('The invoice has payments, so it cannot be changed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save new revision' })).toHaveCount(0);
  await openInvoice(page, clients.k3);
  const oldNumber = (await page.getByRole('heading', { name: /Invoice No\./ }).innerText()).match(
    /S\d+\/43/,
  )?.[0];
  await page.getByLabel('Void reason').fill('Wrong rate');
  await page.getByRole('button', { name: 'Void' }).click();
  await expect(page.getByText('Void').first()).toBeVisible();
  await page.getByRole('button', { name: 'Reissue (new draft)' }).click();
  await expect(page.getByRole('heading', { name: /Invoice draft/ })).toBeVisible();
  await page.getByRole('button', { name: 'Issue and assign a number' }).click();
  const heading = page.getByRole('heading', { name: /Invoice No\. S\d+\/43/ });
  await expect(heading).toBeVisible();
  const newNumber = (await heading.innerText()).match(/S\d+\/43/)?.[0];
  const reissuedUrl = page.url();
  expect(newNumber).not.toBe(oldNumber);
  await page.goto('/payroll');
  await expect(itemCard(page, people.p3)).toContainText(`invoice ${newNumber ?? ''}`);

  // 7. The client never pays: the owner writes the debt off without touching the Ledger (A-065).
  await page.goto(reissuedUrl);
  await page.getByLabel('Write-off reason').fill('Client closed');
  await page.getByRole('button', { name: 'Write off' }).click();
  await expect(page.getByText('Invoice written off')).toBeVisible();
  await expect(page.getByTestId('write-off')).toContainText('Client closed');
});
