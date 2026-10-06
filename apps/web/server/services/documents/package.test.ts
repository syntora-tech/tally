import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { extractPages, parsePageRanges, pdfPageCount } from './package';

describe('parsePageRanges (A-078)', () => {
  it.each([
    ['1-3', [1, 2, 3]],
    ['4', [4]],
    ['1,3-4', [1, 3, 4]],
  ] as const)('%s → %j', (text, pages) => {
    expect(parsePageRanges(text, 5)).toEqual(pages);
  });

  it.each(['0-2', '3-1', '4-6', '1-', 'a', ''])('rejects %s', (text) => {
    expect(parsePageRanges(text, 5)).toBeNull();
  });
});

describe('extractPages', () => {
  it('copies the chosen pages in order', async () => {
    const pdf = await PDFDocument.create();
    for (const width of [100, 200, 300]) pdf.addPage([width, 100]);
    const data = await pdf.save();
    expect(await pdfPageCount(data)).toBe(3);
    const copy = await PDFDocument.load(await extractPages(data, [3, 1]));
    expect(copy.getPages().map((p) => p.getWidth())).toEqual([300, 100]);
  });

  it('reports a file that is not a PDF', async () => {
    expect(await pdfPageCount(new TextEncoder().encode('not a pdf'))).toBeNull();
  });
});
