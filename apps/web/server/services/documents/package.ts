import { PDFDocument } from 'pdf-lib';

/**
 * 1-based page numbers of a range list like "1-10" or "1,3-4", in the order given; null when the
 * text is malformed, a range runs backwards or a page is past `pageCount`.
 */
export function parsePageRanges(text: string, pageCount: number): number[] | null {
  if (!/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(text)) return null;
  const pages: number[] = [];
  for (const part of text.split(',')) {
    const [from, to = from] = part.split('-').map(Number);
    if (from === undefined || to === undefined || from < 1 || to < from || to > pageCount) {
      return null;
    }
    for (let p = from; p <= to; p++) pages.push(p);
  }
  return pages;
}

export async function pdfPageCount(data: Uint8Array): Promise<number | null> {
  try {
    return (await PDFDocument.load(data, { ignoreEncryption: true })).getPageCount();
  } catch {
    return null;
  }
}

/**
 * A copy of some pages for reading. The copy drops the package's signatures, which stay valid
 * only on the original file (A-078).
 */
export async function extractPages(data: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(data, { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const copied = await target.copyPages(
    source,
    pages.map((p) => p - 1),
  );
  for (const page of copied) target.addPage(page);
  return target.save();
}
