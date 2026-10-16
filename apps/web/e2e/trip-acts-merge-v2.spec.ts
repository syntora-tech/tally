import { createDb } from '@tally/db';
import { expect, test } from '@playwright/test';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

// A-108: two draft trip acts of one FOP contract are merged from the act page.
const tag = unique('E2E TRIPACT');
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  tripA: '',
  tripB: '',
  actA: '',
  actB: '',
};

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
      sql`insert into public.company (name_en, name_ua) values ('T', 'Т') returning id`,
    );
    ids.person = await one(sql`insert into public.person (full_name) values (${tag}) returning id`);
    ids.payee = await one(
      sql`insert into public.payee (kind, legal_name_ua, person_id) values ('fop', ${`ФОП ${tag}`}, ${ids.person}) returning id`,
    );
    await d.execute(
      sql`insert into public.number_sequence (key, template, next_value) values (${tag}, 'TA-{seq}', 1)`,
    );
    ids.contract = await one(
      sql`insert into public.contract (kind, number, company_id, payee_id, number_sequence_key) values ('fop', ${tag}, ${ids.company}, ${ids.payee}, ${tag}) returning id`,
    );
    for (const [key, actKey, title, from, to, amount, actDate] of [
      ['tripA', 'actA', `${tag} Sep`, '2055-09-28', '2055-09-30', '6771.72', '2055-10-13'],
      ['tripB', 'actB', `${tag} Nov`, '2055-11-09', '2055-11-12', '32179.72', '2055-11-15'],
    ] as const) {
      ids[key] = await one(
        sql`insert into public.trip (title, starts_on, ends_on) values (${title}, ${from}, ${to}) returning id`,
      );
      await d.execute(
        sql`insert into public.trip_participant (trip_id, person_id) values (${ids[key]}, ${ids.person})`,
      );
      ids[actKey] = await one(sql`
        insert into public.supplier_act (contract_id, payee_id, type, act_date, period_from, period_to, amount_uah)
        values (${ids.contract}, ${ids.payee}, 'reimbursement', ${actDate}, ${from}, ${to}, ${amount}) returning id`);
      await d.execute(sql`
        insert into public.reimbursement (trip_id, person_id, payee_id, amount, method, supplier_act_id)
        values (${ids[key]}, ${ids.person}, ${ids.payee}, ${amount}, 'act', ${ids[actKey]})`);
    }
  } finally {
    await client.end();
  }
});

test.afterAll(async () => {
  const { db: d, sql: client } = db();
  try {
    await d.execute(sql`delete from public.trip where id in (${ids.tripA}, ${ids.tripB})`);
    await d.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.job where payload ->> 'actId' = ${ids.actA}`);
      await tx.execute(sql`create temp table own_docs on commit drop as
        select document_id as id from public.document_link where entity_id in (${ids.actA}, ${ids.payee})`);
      await tx.execute(
        sql`delete from public.document_link where document_id in (select id from own_docs)`,
      );
      await tx.execute(sql`delete from public.document where id in (select id from own_docs)`);
      await tx.execute(sql`delete from public.supplier_act where payee_id = ${ids.payee}`);
    });
    await d.execute(sql`delete from public.contract where id = ${ids.contract}`);
    await d.execute(sql`delete from public.payee where id = ${ids.payee}`);
    await d.execute(sql`delete from public.person where id = ${ids.person}`);
    await d.execute(sql`delete from public.company where id = ${ids.company}`);
    await d.execute(sql`delete from public.number_sequence where key = ${tag}`);
  } finally {
    await client.end();
  }
});

test('two trip act drafts become one act for both trips', async ({ page }) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page
    .context()
    .addCookies([{ name: 'tally_ui', value: 'v2', url: 'http://localhost:3000' }]);
  await page.goto(`/acts/${ids.actA}`);
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Merge with another trip act…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /09\.11\.2055 – 12\.11\.2055/ }).check();
  await dialog.getByRole('button', { name: 'Merge with another trip act' }).click();
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId('act-amount')).toHaveText('38,951.44 UAH');
  await expect(page.getByLabel('Period from')).toHaveValue('2055-09-28');
  await expect(page.getByLabel('Period to')).toHaveValue('2055-11-12');
  await expect(page.getByRole('link', { name: `${tag} Sep` })).toBeVisible();
  await expect(page.getByRole('link', { name: `${tag} Nov` })).toBeVisible();

  // The menu entry that did the merge is gone; issuing must not pop up another one (Void…).
  await page.getByRole('button', { name: 'Issue the act and assign a number' }).click();
  await expect(page.getByTestId('act-status')).toHaveText('Active');
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: `${tag} Nov` }).click();
  await expect(
    page.getByTestId('reimbursement').getByRole('link', { name: /TA-1/ }),
  ).toHaveAttribute('href', `/acts/${ids.actA}`);
  await page.goto(`/acts/${ids.actB}`);
  await expect(page.getByText(/not found|404/i).first()).toBeVisible();
});
