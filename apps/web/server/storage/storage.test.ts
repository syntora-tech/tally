import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { drive_v3 } from '@googleapis/drive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriveStorage, type FolderCache } from './drive-storage';
import { folderPathFor, safeFileName } from './folders';
import { LocalStorage } from './local-storage';

describe('folderPathFor (spec 7.3)', () => {
  it.each([
    ['cv', { kind: 'person', name: 'Andrii H.' }, 'people/andrii-h/cv'],
    ['nda', { kind: 'person', name: 'Andrii H.' }, 'people/andrii-h/docs'],
    [
      'contract',
      { kind: 'client', name: 'Creditor Group Corp.' },
      'clients/creditor-group-corp/contracts',
    ],
    ['invoice', { kind: 'client', name: 'Boosty' }, 'clients/boosty/invoices/2026'],
    [
      'contract',
      { kind: 'payee', name: 'ФОП Щурко Віталія' },
      'payees/fop-shchurko-vitaliia/contracts',
    ],
    ['act', { kind: 'payee', name: 'ФОП Щурко Віталія' }, 'payees/fop-shchurko-vitaliia/acts/2026'],
    [
      'other',
      { kind: 'trip', name: 'Bits&Pretzels Munich', year: '2026' },
      'trips/2026/bits-pretzels-munich',
    ],
    ['statement', { kind: 'none' }, 'ledger/statements/2026'],
    ['other', { kind: 'none' }, 'documents'],
  ] as const)('%s + %j → %s', (type, anchor, path) => {
    expect(folderPathFor(type, anchor, '2026')).toBe(path);
  });

  it('sanitizes file names', () => {
    expect(safeFileName('CV: Andrii/Lead?.pdf')).toBe('CV_ Andrii_Lead_.pdf');
    expect(safeFileName('   ')).toBe('file');
  });
});

describe('LocalStorage', () => {
  let root: string;
  let storage: LocalStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'tally-storage-'));
    storage = new LocalStorage(root);
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it('round-trips bytes and mime type', async () => {
    const data = new TextEncoder().encode('%PDF-1.7 test');
    const { key } = await storage.upload({
      folderPath: 'people/andrii-h/cv',
      fileName: 'CV Andrii.pdf',
      mimeType: 'application/pdf',
      data,
    });
    expect(key).toMatch(/^people\/andrii-h\/cv\/[0-9a-f-]{36}-CV Andrii\.pdf$/);
    const file = await storage.download(key);
    expect(file?.mimeType).toBe('application/pdf');
    expect(new TextDecoder().decode(file?.data)).toBe('%PDF-1.7 test');
    expect(storage.viewUrl()).toBeNull();
  });

  it('returns null for a missing key', async () => {
    expect(await storage.download('documents/missing.pdf')).toBeNull();
  });

  it('rejects keys escaping the root', async () => {
    await expect(storage.download('../../etc/passwd')).rejects.toThrow('escapes');
  });
});

describe('DriveStorage', () => {
  type Created = { name: string; parents: string[]; mimeType?: string | null };

  function fakeDrive(existing: Record<string, string> = {}) {
    const created: Created[] = [];
    let seq = 0;
    const files = {
      list: (params: drive_v3.Params$Resource$Files$List) => {
        const q = params.q ?? '';
        const [, parent, name] = /^'(.+)' in parents and name = '(.+?)'/.exec(q) ?? [];
        const id = existing[`${parent ?? ''}/${name ?? ''}`];
        expect(params.supportsAllDrives).toBe(true);
        return Promise.resolve({ data: { files: id ? [{ id }] : [] } });
      },
      create: (params: drive_v3.Params$Resource$Files$Create) => {
        expect(params.supportsAllDrives).toBe(true);
        const body = params.requestBody ?? {};
        created.push({
          name: body.name ?? '',
          parents: body.parents ?? [],
          mimeType: body.mimeType,
        });
        seq += 1;
        return Promise.resolve({ data: { id: `id-${seq}` } });
      },
    };
    return { files: files as unknown as drive_v3.Resource$Files, created };
  }

  function memoryCache(): FolderCache & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      get: (path) => Promise.resolve(map.get(path) ?? null),
      set: (path, id) => {
        map.set(path, id);
        return Promise.resolve();
      },
    };
  }

  it('creates missing folders lazily under the root and caches them', async () => {
    const { files, created } = fakeDrive({ 'root/people': 'people-id' });
    const cache = memoryCache();
    const storage = new DriveStorage(files, 'root', cache);

    const { key } = await storage.upload({
      folderPath: 'people/andrii-h/cv',
      fileName: 'cv.pdf',
      mimeType: 'application/pdf',
      data: new Uint8Array([1, 2, 3]),
    });

    expect(created.map((c) => [c.name, c.parents[0]])).toEqual([
      ['andrii-h', 'people-id'],
      ['cv', 'id-1'],
      ['cv.pdf', 'id-2'],
    ]);
    expect(key).toBe('id-3');
    expect(Object.fromEntries(cache.map)).toEqual({
      people: 'people-id',
      'people/andrii-h': 'id-1',
      'people/andrii-h/cv': 'id-2',
    });
  });

  it('reuses cached folders without calling Drive', async () => {
    const { files, created } = fakeDrive();
    const cache = memoryCache();
    await cache.set('documents', 'docs-id');
    const storage = new DriveStorage(files, 'root', cache);
    expect(await storage.ensureFolder('documents')).toBe('docs-id');
    expect(created).toHaveLength(0);
    expect(storage.viewUrl('abc')).toBe('https://drive.google.com/file/d/abc/view');
  });
});
