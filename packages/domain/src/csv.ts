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
