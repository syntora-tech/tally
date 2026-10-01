import { client, company, contract, document, person } from '@tally/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { documentServices } from '.';
import { LocalStorage } from '../../storage/local-storage';
import { getDocument, linkDocument, searchDocuments, unlinkDocument } from './registry';

const h = intHarness();
const services = documentServices(() => new LocalStorage('/tmp/unused-tally'));
let owner: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
const ids = { person: '', client: '', company: '', contract: '' };
const docIds: string[] = [];
const tag = `reg-${Date.now()}`;

beforeAll(async () => {
  owner = await h.user('owner');
  viewer = await h.user('viewer');
  const [p] = await h.db.insert(person).values({ fullName: 'Доліна Максим' }).returning();
  const [cl] = await h.db
    .insert(client)
    .values({ legalName: 'Creditor Group Corp.', shortName: 'Creditor' })
    .returning();
  const [co] = await h.db.insert(company).values({ nameEn: 'S', nameUa: 'С' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'client',
      number: 'MSA №20-08/25',
      companyId: co?.id ?? '',
      clientId: cl?.id ?? '',
    })
    .returning();
  Object.assign(ids, { person: p?.id, client: cl?.id, company: co?.id, contract: ct?.id });
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (docIds.length) await db.delete(document).where(inArray(document.id, docIds));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(company).where(eq(company.id, ids.company));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(person).where(eq(person.id, ids.person));
  }),
);

describe('document registry (spec 6.9)', () => {
  it('AC: a document may have no links', async () => {
    const { id } = (
      await services.createDocument.run(h.ctxFor(owner), {
        type: 'act',
        title: `${tag} act`,
        number: '1003  -А4',
        url: 'https://vchasno.ua/doc/a4',
      })
    )._unsafeUnwrap();
    docIds.push(id);
    const card = (await getDocument.run(h.ctxFor(owner), { id }))._unsafeUnwrap();
    expect(card.links).toEqual([]);
  });

  it('finds the act by any spelling of its number (number_key)', async () => {
    for (const q of ['1003 - А4', '1003-A4', '1003а4']) {
      const rows = (await searchDocuments.run(h.ctxFor(viewer), { q }))._unsafeUnwrap();
      expect(rows.map((r) => r.id)).toContain(docIds[0]);
    }
  });

  it('AC: one document linked to a person, a client and a contract at once', async () => {
    const { id } = (
      await services.createDocument.run(h.ctxFor(owner), {
        type: 'nda',
        title: `${tag} NDA`,
        url: 'https://drive.google.com/x',
        links: [
          { entityType: 'person', entityId: ids.person },
          { entityType: 'client', entityId: ids.client },
        ],
      })
    )._unsafeUnwrap();
    docIds.push(id);
    expect(
      (
        await linkDocument.run(h.ctxFor(owner), {
          documentId: id,
          entityType: 'contract',
          entityId: ids.contract,
        })
      ).isOk(),
    ).toBe(true);

    const card = (await getDocument.run(h.ctxFor(owner), { id }))._unsafeUnwrap();
    expect(card.links.map((l) => [l.entityType, l.label])).toEqual([
      ['person', 'Доліна Максим'],
      ['client', 'Creditor'],
      ['contract', 'MSA №20-08/25'],
    ]);

    const [row] = (await searchDocuments.run(h.ctxFor(owner), { q: `${tag} NDA` }))._unsafeUnwrap();
    expect(row?.links).toHaveLength(3);
  });

  it('viewer sees the document but labels of finance-only entities are hidden', async () => {
    const card = (await getDocument.run(h.ctxFor(viewer), { id: docIds[1] ?? '' }))._unsafeUnwrap();
    const contractChip = card.links.find((l) => l.entityType === 'contract');
    expect(contractChip).toMatchObject({ label: 'documents.recordUnavailable', href: null });
    const link = await linkDocument.run(h.ctxFor(viewer), {
      documentId: docIds[1],
      entityType: 'person',
      entityId: ids.person,
    });
    expect(link._unsafeUnwrapErr().code).toBe('forbidden');
  });

  it('unlinks and filters unlinked documents', async () => {
    await unlinkDocument.run(h.ctxFor(owner), {
      documentId: docIds[1],
      entityType: 'contract',
      entityId: ids.contract,
    });
    const card = (await getDocument.run(h.ctxFor(owner), { id: docIds[1] ?? '' }))._unsafeUnwrap();
    expect(card.links).toHaveLength(2);
    const unlinked = (
      await searchDocuments.run(h.ctxFor(owner), { q: tag, unlinked: 'on' })
    )._unsafeUnwrap();
    expect(unlinked.map((r) => r.id)).toEqual([docIds[0]]);
  });
});
