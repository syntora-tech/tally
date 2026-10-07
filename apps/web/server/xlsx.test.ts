import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { columnName, excelSerial, writeXlsx } from './xlsx';

/** Entries of a zip written by `writeXlsx`, read through its central directory. */
function unzip(buffer: Buffer): Map<string, string> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const dataAt = offset + 30 + buffer.readUInt16LE(offset + 26);
    files.set(name, inflateRawSync(buffer.subarray(dataAt, dataAt + size)).toString('utf8'));
    at += 46 + nameLength;
  }
  return files;
}

describe('xlsx writer', () => {
  it('names columns and dates like Excel', () => {
    expect([columnName(0), columnName(3), columnName(25), columnName(26), columnName(27)]).toEqual([
      'A',
      'D',
      'Z',
      'AA',
      'AB',
    ]);
    expect(excelSerial('1900-03-01')).toBe(61);
    expect(excelSerial('2026-01-16')).toBe(46038);
  });

  it('packs a sheet with exact numbers, dates and formulas', () => {
    const files = unzip(
      writeXlsx({
        name: 'Acts & co',
        widths: [30, 12],
        rows: [
          [{ s: 'Контрагент', bold: true }, { s: '<x>' }],
          [{ date: '2026-01-16' }, { n: '30546.50' }],
          [],
          [null, { n: '30546.50', bold: true, formula: 'SUM(B2:B2)' }],
        ],
      }),
    );
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(files.get('xl/workbook.xml')).toContain('name="Acts &amp; co"');
    const sheet = files.get('xl/worksheets/sheet1.xml') ?? '';
    expect(sheet).toContain(
      '<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Контрагент</t>',
    );
    expect(sheet).toContain('&lt;x&gt;');
    expect(sheet).toContain('<c r="A2" s="2"><v>46038</v></c>');
    expect(sheet).toContain('<c r="B2" s="3"><v>30546.50</v></c>');
    expect(sheet).toContain('<row r="3"></row>');
    expect(sheet).toContain('<c r="B4" s="4"><f>SUM(B2:B2)</f><v>30546.50</v></c>');
  });
});
