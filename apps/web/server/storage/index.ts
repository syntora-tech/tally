import 'server-only';
import { drive } from '@googleapis/drive';
import { driveFolder } from '@tally/db/schema';
import { eq } from 'drizzle-orm';
import { JWT } from 'google-auth-library';
import { getDb } from '../db/client';
import { withSystem } from '../db/with-user';
import { driveConfig, getServerEnv } from '../env';
import { DriveStorage, type FolderCache } from './drive-storage';
import { LocalStorage } from './local-storage';
import type { DocumentStorage } from './types';

export type { DocumentStorage } from './types';
export { folderPathFor, type FolderAnchor } from './folders';

const dbFolderCache: FolderCache = {
  get: async (path) => {
    const [row] = await withSystem(getDb(), 'system:storage', (tx) =>
      tx
        .select({ folderId: driveFolder.folderId })
        .from(driveFolder)
        .where(eq(driveFolder.path, path)),
    );
    return row?.folderId ?? null;
  },
  set: async (path, folderId) => {
    await withSystem(getDb(), 'system:storage', (tx) =>
      tx.insert(driveFolder).values({ path, folderId }).onConflictDoNothing(),
    );
  },
};

let storage: DocumentStorage | undefined;

export function getDocumentStorage(): DocumentStorage {
  if (storage) return storage;
  const env = getServerEnv();
  if (env.STORAGE_DRIVER === 'local') {
    storage = new LocalStorage(env.STORAGE_LOCAL_DIR);
  } else {
    const { email, privateKey, rootId } = driveConfig(env);
    const auth = new JWT({
      email,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    storage = new DriveStorage(drive({ version: 'v3', auth }).files, rootId, dbFolderCache);
  }
  return storage;
}
