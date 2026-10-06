import {
  client,
  company,
  contract,
  contractAnnex,
  document,
  documentLink,
  payee,
} from '@tally/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { counterpartyDossier, documentChecks, documentInbox } from './structure';

const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
const tag = `dossier-${String(Date.now())}`;
const ids = { client: '', company: '', contract: '', annex: '', payee: '' };
const docs: Record<string, string> = {};

beforeAll(async () => {
  owner = await h.user('owner');
  const [cl] = await h.db
    .insert(client)
    .values({ legalName: `${tag} Client` })
    .returning();
  const [co] = await h.db.insert(company).values({ nameEn: 'D', nameUa: 'Д' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'client', number: `${tag} MSA`, companyId: co?.id ?? '', clientId: cl?.id })
    .returning();
  const [an] = await h.db
    .insert(contractAnnex)
    .values({ contractId: ct?.id ?? '', kind: 'sow', number: '7' })
    .returning();
  const [py] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: `ФОП ${tag}` })
    .returning();
  Object.assign(ids, {
    client: cl?.id,
    company: co?.id,
    contract: ct?.id,
    annex: an?.id,
    payee: py?.id,
  });
  const rows = await h.db
    .insert(document)
    .values([
      {
        type: 'sow',
        title: `${tag} SOW 7`,
        number: '7',
        docDate: '2026-01-01',
        url: 'https://x.test/s',
      },
      {
        type: 'invoice',
        title: `${tag} inv A`,
        number: `${tag}/1`,
        docDate: '2026-02-03',
        url: 'https://x.test/a',
      },
      {
        type: 'invoice',
        title: `${tag} inv B`,
        number: `${tag}/1`,
        docDate: '2026-03-02',
        url: 'https://x.test/b',
      },
      { type: 'contract', title: `${tag} loose`, url: 'https://x.test/l' },
      { type: 'contract', title: `${tag} old`, url: 'https://x.test/o', historical: true },
      {
        type: 'invoice',
        title: `${tag} old inv`,
        number: `${tag}/1`,
        docDate: '2025-02-03',
        url: 'https://x.test/oi',
        historical: true,
      },
    ])
    .returning({ id: document.id, title: document.title });
  for (const r of rows) docs[r.title.replace(`${tag} `, '')] = r.id;
  await h.db.insert(documentLink).values([
    { documentId: docs['SOW 7'] ?? '', entityType: 'contract_annex', entityId: ids.annex },
    { documentId: docs['inv A'] ?? '', entityType: 'contract', entityId: ids.contract },
    { documentId: docs['inv B'] ?? '', entityType: 'client', entityId: ids.client },
  ]);
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(document).where(inArray(document.id, Object.values(docs)));
    await db.delete(contractAnnex).where(eq(contractAnnex.id, ids.annex));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(company).where(eq(company.id, ids.company));
    await db.delete(client).where(eq(client.id, ids.client));
  }),
);

describe('document structure (A-079)', () => {
  it('the case file files documents under SOW, contract or neither', async () => {
    const d = (
      await counterpartyDossier.run(h.ctxFor(owner), { party: 'client', id: ids.client })
    )._unsafeUnwrap();
    const [c] = d.contracts;
    expect(c?.annexes[0]?.docs.map((x) => x.id)).toEqual([docs['SOW 7']]);
    expect(c?.months).toMatchObject([{ month: '2026-02', docs: [{ id: docs['inv A'] }] }]);
    expect(d.unfiled.months).toMatchObject([{ month: '2026-03', docs: [{ id: docs['inv B'] }] }]);
  });

  it('the inbox lists what is missing', async () => {
    const items = (await documentInbox.run(h.ctxFor(owner), {}))._unsafeUnwrap();
    expect(items.find((i) => i.id === docs.loose)?.reasons).toEqual([
      'noLinks',
      'noDate',
      'noNumber',
    ]);
    expect(items.find((i) => i.id === docs['SOW 7'])).toBeUndefined();
    // A-080: history stays as it is.
    expect(items.find((i) => i.id === docs.old)).toBeUndefined();
  });

  it('checks find a FOP without a contract, a contract without a file and repeated numbers', async () => {
    const c = (await documentChecks.run(h.ctxFor(owner), {}))._unsafeUnwrap();
    expect(c.payeesWithoutContract.map((p) => p.id)).toContain(ids.payee);
    expect(c.contractsWithoutFile.map((x) => x.id)).toContain(ids.contract);
    expect(c.annexesWithoutFile.map((x) => x.id)).not.toContain(ids.annex);
    expect(c.duplicateNumbers.find((g) => g.number === `${tag}/1`)?.docs.map((d) => d.id)).toEqual([
      docs['inv A'],
      docs['inv B'],
    ]);
  });
});
