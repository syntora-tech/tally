import { Readable } from 'node:stream';
import type { drive_v3 } from '@googleapis/drive';
import { safeFileName } from './folders';
import type { DocumentStorage, DownloadedFile, StoredFile, UploadInput } from './types';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Maps folder paths to Drive folder ids; backed by the `drive_folder` table at runtime. */
export interface FolderCache {
  get(path: string): Promise<string | null>;
  set(path: string, folderId: string): Promise<void>;
}

type DriveFiles = Pick<drive_v3.Resource$Files, 'list' | 'create' | 'get' | 'update'>;

function escapeQuery(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

/**
 * Google Shared Drive storage (spec 7.3): folders are created lazily under the environment root and
 * cached; every call sets `supportsAllDrives` because a service account has no My Drive quota.
 */
export class DriveStorage implements DocumentStorage {
  readonly driver = 'drive' as const;

  constructor(
    private readonly files: DriveFiles,
    private readonly rootId: string,
    private readonly cache: FolderCache,
  ) {}

  async upload({ folderPath, fileName, mimeType, data }: UploadInput): Promise<StoredFile> {
    const parentId = await this.ensureFolder(folderPath);
    const res = await this.files.create({
      supportsAllDrives: true,
      requestBody: { name: safeFileName(fileName), parents: [parentId] },
      media: { mimeType, body: Readable.from(Buffer.from(data)) },
      fields: 'id',
    });
    if (!res.data.id) throw new Error('Drive did not return a file id');
    return { key: res.data.id };
  }

  /** Bytes of an uploaded file; native Google Docs have no bytes of their own and return null. */
  async download(key: string): Promise<DownloadedFile | null> {
    const meta = await this.files.get({ fileId: key, fields: 'mimeType', supportsAllDrives: true });
    const mimeType = meta.data.mimeType ?? 'application/octet-stream';
    if (mimeType.startsWith('application/vnd.google-apps.')) return null;
    const res = await this.files.get(
      { fileId: key, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    return { data: new Uint8Array(res.data as unknown as ArrayBuffer), mimeType };
  }

  viewUrl(key: string): string {
    return `https://drive.google.com/file/d/${encodeURIComponent(key)}/view`;
  }

  async trash(key: string): Promise<void> {
    await this.files.update({
      fileId: key,
      supportsAllDrives: true,
      requestBody: { trashed: true },
    });
  }

  async ensureFolder(path: string): Promise<string> {
    let parentId = this.rootId;
    let current = '';
    for (const segment of path.split('/').filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      const cached = await this.cache.get(current);
      if (cached) {
        parentId = cached;
        continue;
      }
      parentId =
        (await this.findFolder(parentId, segment)) ?? (await this.createFolder(parentId, segment));
      await this.cache.set(current, parentId);
    }
    return parentId;
  }

  private async findFolder(parentId: string, name: string): Promise<string | null> {
    const res = await this.files.list({
      q: `'${escapeQuery(parentId)}' in parents and name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: 'allDrives',
    });
    return res.data.files?.[0]?.id ?? null;
  }

  private async createFolder(parentId: string, name: string): Promise<string> {
    const res = await this.files.create({
      supportsAllDrives: true,
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: 'id',
    });
    if (!res.data.id) throw new Error(`Drive did not return an id for folder ${name}`);
    return res.data.id;
  }
}
