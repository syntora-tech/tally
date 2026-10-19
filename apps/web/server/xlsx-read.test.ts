import { describe, expect, it } from 'vitest';
import { writeXlsx } from './xlsx';
import { readXlsxFirstSheet } from './xlsx-read';

describe('xlsx reader', () => {
  it('reads back what the writer wrote, strings and numbers in place', () => {
    const file = writeXlsx({
      name: 'Statement',
      widths: [12, 12, 30],
      rows: [
        [{ s: 'Виписка за жовтень' }],
        [],
        [
          { s: 'Дата операції' },
          { s: 'Дебет' },
          { s: 'Призначення платежу' },
          { date: '2026-10-02' },
        ],
        [{ s: '02.10.2026' }, { n: '45624.6' }, { s: 'Оплата & <послуги> "ФОП"' }, null],
      ],
    });
    const rows = readXlsxFirstSheet(file)._unsafeUnwrap();
    expect(rows[0]).toEqual(['Виписка за жовтень']);
    expect(rows[1]).toEqual([]);
    expect(rows[2]).toEqual(['Дата операції', 'Дебет', 'Призначення платежу', '46297']);
    expect(rows[3]?.slice(0, 3)).toEqual(['02.10.2026', '45624.6', 'Оплата & <послуги> "ФОП"']);
  });

  it('rejects files that are not xlsx', () => {
    expect(readXlsxFirstSheet(Buffer.from('Дата;Сума\n')).isErr()).toBe(true);
    expect(readXlsxFirstSheet(Buffer.alloc(0)).isErr()).toBe(true);
  });
});
