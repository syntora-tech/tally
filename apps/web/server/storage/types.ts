export type UploadInput = {
  /** Folder path relative to the environment root, e.g. `people/andrii-h/cv`. */
  folderPath: string;
  fileName: string;
  mimeType: string;
  data: Uint8Array;
};

export type StoredFile = {
  /** Driver-specific key stored in `document.drive_file_id`. */
  key: string;
};

export type DownloadedFile = { data: Uint8Array; mimeType: string };

export type StorageDriver = 'drive' | 'local';

/** Two implementations per spec 7.3: Google Shared Drive and local disk (`STORAGE_DRIVER`). */
export interface DocumentStorage {
  readonly driver: StorageDriver;
  upload(input: UploadInput): Promise<StoredFile>;
  /** The file's bytes (for agents); the UI opens Drive files through `viewUrl` instead. */
  download(key: string): Promise<DownloadedFile | null>;
  /** Where the browser should go to view the file, or null to stream it from `/api/files`. */
  viewUrl(key: string): string | null;
  /** Removes the file: Drive moves it to the trash (restorable for 30 days), local disk deletes it. */
  trash(key: string): Promise<void>;
}
