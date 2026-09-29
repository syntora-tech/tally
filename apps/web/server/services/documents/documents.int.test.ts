import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { document, documentLink, person } from '@tally/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { LocalStorage } from '../../storage/local-storage';
import { documentsForEntity } from './read';
import { documentServices } from '.';

const h = intHarness();
let root: string;
let storage: LocalStorage;
let services: ReturnType<typeof documentServices>;
let owner: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
let personId: string;
const docIds: string[] = [];

const pdf = (name: string, body = '%PDF-1.7') =>
  new File([body], name, { type: 'application/pdf' });

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tally-docs-'));
  storage = new LocalStorage(root);
  services = documentServices(() => storage);
  owner = await h.user('owner');
  viewer = await h.user('viewer');
  const [p] = await h.db.insert(person).values({ fullName: 'Андрій Гриценко' }).returning();
  personId = p?.id ?? '';
});

afterAll(async () => {
  await h.cleanup(async (db) => {
    if (docIds.length) {
      await db.update(document).set({ supersedesId: null }).where(inArray(document.id, docIds));
      await db.delete(document).where(inArray(document.id, docIds));
    }
    await db.delete(person).where(eq(person.id, personId));
  });
  await rm(root, { recursive: true, force: true });
});

describe('uploadCv (spec 6.2)', () => {
  it('stores the first CV under people/{slug}/cv and links it to the person', async () => {
    const res = await services.uploadCv.run(h.ctxFor(owner), {
      personId,
      file: pdf('CV Andrii.pdf'),
    });
    const { id } = res._unsafeUnwrap();
    docIds.push(id);
    const [doc] = await h.db.select().from(document).where(eq(document.id, id));
    expect(doc).toMatchObject({ type: 'cv', title: 'CV Andrii', version: 1, supersedesId: null });
    expect(doc?.driveFileId).toMatch(/^people\/andrii-hrytsenko\/cv\//);
    expect(await storage.download(doc?.driveFileId ?? '')).not.toBeNull();
  });

  it('a new upload supersedes the current version', async () => {
    const res = await services.uploadCv.run(h.ctxFor(owner), { personId, file: pdf('CV v2.pdf') });
    const { id } = res._unsafeUnwrap();
    docIds.push(id);
    const [doc] = await h.db.select().from(document).where(eq(document.id, id));
    expect(doc).toMatchObject({ version: 2, supersedesId: docIds[0] });

    const third = (
      await services.uploadCv.run(h.ctxFor(owner), { personId, file: pdf('CV v3.pdf') })
    )._unsafeUnwrap();
    docIds.push(third.id);
    const [v3] = await h.db.select().from(document).where(eq(document.id, third.id));
    expect(v3).toMatchObject({ version: 3, supersedesId: id });
  });

  it('lists all versions on the person card, visible to viewer', async () => {
    const res = await documentsForEntity.run(h.ctxFor(viewer), {
      entityType: 'person',
      entityId: personId,
    });
    expect(
      res
        ._unsafeUnwrap()
        .map((d) => d.version)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it('rejects non-PDF files and viewers', async () => {
    const txt = new File(['hello'], 'cv.txt', { type: 'text/plain' });
    const bad = await services.uploadCv.run(h.ctxFor(owner), { personId, file: txt });
    expect(bad._unsafeUnwrapErr().fieldErrors?.file?.[0]).toBe('CV має бути у форматі PDF');
    const forbidden = await services.uploadCv.run(h.ctxFor(viewer), {
      personId,
      file: pdf('x.pdf'),
    });
    expect(forbidden._unsafeUnwrapErr().code).toBe('forbidden');
  });

  it('rejects files above 4 MB', async () => {
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    });
    const res = await services.uploadCv.run(h.ctxFor(owner), { personId, file: big });
    expect(res._unsafeUnwrapErr().fieldErrors?.file?.[0]).toBe('Файл більший за 4 МБ');
  });
});

describe('createDocument (spec 6.9)', () => {
  it('requires a file or a link', async () => {
    const res = await services.createDocument.run(h.ctxFor(owner), { type: 'nda', title: 'NDA' });
    expect(res._unsafeUnwrapErr().fieldErrors?.file?.[0]).toBe('Додайте файл або посилання');
  });

  it('stores unlinked files under documents/ and accepts link-only documents', async () => {
    const withFile = (
      await services.createDocument.run(h.ctxFor(owner), {
        type: 'other',
        title: 'Policy',
        file: pdf('policy.pdf'),
      })
    )._unsafeUnwrap();
    docIds.push(withFile.id);
    const [doc] = await h.db.select().from(document).where(eq(document.id, withFile.id));
    expect(doc?.driveFileId).toMatch(/^documents\//);

    const linkOnly = (
      await services.createDocument.run(h.ctxFor(owner), {
        type: 'act',
        title: 'Vchasno act',
        number: '1003 - А4',
        url: 'https://vchasno.ua/doc/1',
        links: [{ entityType: 'person', entityId: personId }],
      })
    )._unsafeUnwrap();
    docIds.push(linkOnly.id);
    const links = await h.db
      .select()
      .from(documentLink)
      .where(eq(documentLink.documentId, linkOnly.id));
    expect(links).toHaveLength(1);
  });

  it('rejects non-http links', async () => {
    const res = await services.createDocument.run(h.ctxFor(owner), {
      type: 'other',
      title: 'X',
      url: 'javascript:alert(1)',
    });
    expect(res._unsafeUnwrapErr().code).toBe('validation_error');
  });
});
