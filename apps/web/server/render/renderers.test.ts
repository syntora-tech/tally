import type { docs_v1 } from '@googleapis/docs';
import { describe, expect, it, vi } from 'vitest';
import type { InvoiceSnapshot } from '../services/invoices/snapshot';
import type { DriveStorage } from '../storage/drive-storage';
import { GoogleDocsRenderer } from './renderers';

const doc = (text: string): docs_v1.Schema$Document => ({
  body: {
    content: [
      {
        paragraph: {
          elements: [{ startIndex: 1, endIndex: 1 + text.length, textRun: { content: text } }],
        },
      },
    ],
  },
});

function setup(templateText: string) {
  const files = {
    copy: vi.fn().mockResolvedValue({ data: { id: 'copy-1' } }),
    export: vi.fn().mockResolvedValue({ data: new ArrayBuffer(3) }),
    delete: vi.fn().mockResolvedValue({}),
  };
  const documents = {
    get: vi.fn().mockResolvedValue({ data: doc(templateText) }),
    batchUpdate: vi.fn().mockResolvedValue({}),
  };
  const storage = { ensureFolder: vi.fn().mockResolvedValue('folder-1') };
  const renderer = new GoogleDocsRenderer(files, documents, storage as unknown as DriveStorage);
  return { files, storage, renderer };
}

const input = {
  layout: 'invoice_hourly' as const,
  templateId: 'template-1',
  fileName: 'Invoice 31-26 IdeaSoft 2026-11-03 (preview)',
  snapshot: { doc: { number: '31/26' }, lines: [] } as unknown as InvoiceSnapshot,
};

describe('GoogleDocsRenderer.preview', () => {
  it('exports the filled copy and deletes it', async () => {
    const { files, storage, renderer } = setup('Invoice {{doc.number}}\n');
    const file = await renderer.preview(input);
    expect(file).toMatchObject({ mimeType: 'application/pdf', fileName: `${input.fileName}.pdf` });
    expect(storage.ensureFolder).toHaveBeenCalledWith('_previews');
    expect(files.delete).toHaveBeenCalledWith({ fileId: 'copy-1', supportsAllDrives: true });
  });

  it('deletes the copy when the template cannot be filled', async () => {
    const { files, renderer } = setup('Invoice {{doc.unknown}}\n');
    await expect(renderer.preview(input)).rejects.toThrow('doc.unknown');
    expect(files.export).not.toHaveBeenCalled();
    expect(files.delete).toHaveBeenCalledWith({ fileId: 'copy-1', supportsAllDrives: true });
  });

  it('keeps the copy of a real render', async () => {
    const { files, renderer } = setup('Invoice {{doc.number}}\n');
    const out = await renderer.render({ ...input, folderPath: 'Invoices/2026' });
    expect(out.sourceFileId).toBe('copy-1');
    expect(files.delete).not.toHaveBeenCalled();
  });
});
