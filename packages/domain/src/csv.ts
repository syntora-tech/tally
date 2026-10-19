const BOM = '\uFEFF';

export type CsvColumn<T> = { header: string; value: (row: T) => string | null | undefined };

function escapeCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** RFC 4180 CSV with CRLF line endings and a UTF-8 BOM so Excel opens Cyrillic correctly. */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [
    columns.map((c) => escapeCell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => escapeCell(c.value(row) ?? '')).join(',')),
  ];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/**
 * RFC 4180 reader for uploaded tables: `;`, `,` or tab delimiter (picked from the line with the
 * most of them among the first lines, as bank exports may start with title lines), quoted
 * fields with doubled quotes and line breaks, optional BOM.
 */
export function parseCsvTable(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const head = source.split(/\r?\n/, 20);
  const count = (d: string) => Math.max(...head.map((l) => l.split(d).length - 1), 0);
  const delimiter = [';', '\t', ','].reduce((best, d) => (count(d) > count(best) ? d : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (quoted) {
      if (ch === '"' && source.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
