import { expect, test } from '@playwright/test';
import { createDb } from '@tally/db';
import { sql } from 'drizzle-orm';
import { E2E_OWNER_EMAIL } from '../playwright.config';
import { localEnv, signIn, unique } from './helpers';

const agent = unique('E2E agent');

test.afterAll(async () => {
  const { db, sql: client } = createDb(
    localEnv().DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 1 },
  );
  try {
    await db.execute(sql`
      delete from public.mcp_call_log where client_id in
        (select client_id from public.mcp_client_policy where client_name = ${agent})
    `);
    await db.execute(sql`delete from public.mcp_client_policy where client_name = ${agent}`);
  } finally {
    await client.end();
  }
});

test('AC 13.6: the owner issues an MCP token, the agent calls /api/mcp, revoke → 403', async ({
  page,
  request,
}) => {
  await signIn(page, E2E_OWNER_EMAIL);
  await page.goto('/settings');
  await page.getByLabel('Назва агента').fill(agent);
  await page.getByLabel('Доступ').selectOption('assistant');
  await page.getByRole('button', { name: 'Створити токен' }).click();
  const token = (await page.locator('code', { hasText: /^tally_pat_/ }).textContent()) ?? '';
  expect(token).toMatch(/^tally_pat_/);

  const call = () =>
    request.post('/api/mcp', {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json, text/event-stream',
      },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      maxRedirects: 0,
    });
  const listed = await call();
  expect(listed.status()).toBe(200);
  const body = (await listed.json()) as { result: { tools: { name: string }[] } };
  expect(body.result.tools.map((t) => t.name)).toContain('add_transactions');

  await page.reload();
  const row = page.getByRole('listitem').filter({ hasText: agent });
  await row.getByRole('button', { name: 'Відкликати' }).click();
  await expect(row.getByText('відкликано')).toBeVisible();
  expect((await call()).status()).toBe(403);
});
