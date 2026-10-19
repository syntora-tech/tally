import { inflateRawSync } from 'node:zlib';
import { err, ok, type Result } from 'neverthrow';

/**
 * Minimal reader for the first worksheet of an .xlsx (bank statements, A-121): zip central
 * directory → shared strings + sheet XML → rows of cell text. Numbers and dates come back as
 * stored (dates as Excel serial days). No formulas are evaluated; cached values are used.
 */

export type XlsxError = 'not_xlsx' | 'unsupported_zip' | 'no_sheet';

const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

function readZip(buf: Buffer): Result<Map<string, Buffer>, XlsxError> {
  // End of central directory record: scan back from the end (comment up to 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return err('not_xlsx');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) return err('not_xlsx');
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/\.(xml|rels)$/.test(name)) continue;
    if (size > MAX_ENTRY_BYTES) return err('unsupported_zip');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return err('not_xlsx');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (method === 0) files.set(name, data);
    else if (method === 8)
      files.set(name, inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }));
    else return err('unsupported_zip');
  }
  return ok(files);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
    if (e.startsWith('#x') || e.startsWith('#X'))
      return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
    return ENTITIES[e] ?? whole;
  });
}

/** Text of all `<t>` runs inside an element (rich text keeps several). */
const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1] ?? '')).join('');

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsxFirstSheet(buf: Buffer): Result<string[][], XlsxError> {
  const zip = readZip(buf);
  if (zip.isErr()) return err(zip.error);
  const files = zip.value;
  const workbook = files.get('xl/workbook.xml')?.toString('utf8');
  const rels = files.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbook || !rels) return err('not_xlsx');
  const relId = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const target = relId
    ? (new RegExp(`<Relationship\\b[^>]*Id="${relId}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ??
      new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${relId}"`).exec(rels)?.[1])
    : undefined;
  const sheetPath = target
    ? target.startsWith('/')
      ? target.slice(1)
      : `xl/${target}`
    : undefined;
  const sheet = sheetPath ? files.get(sheetPath)?.toString('utf8') : undefined;
  if (!sheet) return err('no_sheet');
  const shared = [
    ...(files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '').matchAll(
      /<si>([\s\S]*?)<\/si>/g,
    ),
  ].map((m) => textOf(m[1] ?? ''));
  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowMatch[1] ?? '')?.[1] ?? rows.length + 1);
    const cells: string[] = [];
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const inner = c[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const value =
        type === 's'
          ? (shared[Number(v)] ?? '')
          : type === 'inlineStr'
            ? textOf(inner)
            : unescapeXml(v ?? '');
      cells[ref ? columnIndex(ref) : cells.length] = value;
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    // Sparse rows leave holes where cells were skipped; Array.from turns them into undefined.
    rows.push(Array.from(cells, (x: string | undefined) => x ?? ''));
  }
  return ok(rows);
}
