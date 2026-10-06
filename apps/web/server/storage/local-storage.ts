import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { safeFileName } from './folders';
import type { DocumentStorage, DownloadedFile, StoredFile, UploadInput } from './types';

const META_SUFFIX = '.meta.json';

/** Files under a root directory; the key is the path relative to that root. */
export class LocalStorage implements DocumentStorage {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async upload({ folderPath, fileName, mimeType, data }: UploadInput): Promise<StoredFile> {
    const key = `${folderPath}/${randomUUID()}-${safeFileName(fileName)}`;
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    await writeFile(`${path}${META_SUFFIX}`, JSON.stringify({ mimeType }));
    return { key };
  }

  async download(key: string): Promise<DownloadedFile | null> {
    const path = this.resolveKey(key);
    try {
      const [data, meta] = await Promise.all([
        readFile(path),
        readFile(`${path}${META_SUFFIX}`, 'utf8'),
      ]);
      const { mimeType } = JSON.parse(meta) as { mimeType: string };
      return { data: new Uint8Array(data), mimeType };
    } catch {
      return null;
    }
  }

  viewUrl(): null {
    return null;
  }

  async trash(key: string): Promise<void> {
    const path = this.resolveKey(key);
    await Promise.all([rm(path, { force: true }), rm(`${path}${META_SUFFIX}`, { force: true })]);
  }

  /** Rejects keys that escape the root (`../`), since keys come from the database. */
  private resolveKey(key: string): string {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Storage key escapes the storage root');
    }
    return path;
  }
}
