import { randomUUID } from 'node:crypto';
import { client } from '@tally/db/schema';
import { like } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { upsertClients } from './batch';

const h = intHarness();
const tag = randomUUID().slice(0, 8);
let finance: Awaited<ReturnType<typeof h.user>>;

beforeAll(async () => {
  finance = await h.user('finance');
});

afterAll(() => h.cleanup((db) => db.delete(client).where(like(client.legalName, `C ${tag}%`))));

it('creates a client with contacts, then patches by legal name; dry run writes nothing', async () => {
  const ctx = h.ctxFor(finance);
  const legalName = `C ${tag} GmbH`;
  const item = {
    legalName,
    country: 'Germany',
    defaultCurrency: 'eur',
    contacts: [{ name: 'Anna', email: 'anna@example.com' }],
  };
  const dry = await upsertClients.run(ctx, { clients: [item], dryRun: true });
  expect(dry._unsafeUnwrap().clients[0]?.status).toBe('created');
  expect(
    await h.db
      .select()
      .from(client)
      .where(like(client.legalName, `C ${tag}%`)),
  ).toHaveLength(0);

  await upsertClients.run(ctx, { clients: [item] });
  const patched = await upsertClients.run(ctx, {
    clients: [{ legalName: legalName.toLowerCase(), shortName: 'Acme' }],
  });
  expect(patched._unsafeUnwrap().clients[0]?.status).toBe('updated');
  const [row] = await h.db
    .select()
    .from(client)
    .where(like(client.legalName, `C ${tag}%`));
  expect(row).toMatchObject({
    shortName: 'Acme',
    country: 'Germany',
    defaultCurrency: 'EUR',
    contacts: [{ name: 'Anna', email: 'anna@example.com' }],
  });
});
