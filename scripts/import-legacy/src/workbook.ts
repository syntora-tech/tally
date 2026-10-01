import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import type { Cell } from './cells';

export type Sheet = {
  file: string;
  name: string;
  hidden: boolean;
  /** rows[r][c], 0-based; missing cells are `{ v: undefined }`. */
  rows: Cell[][];
};

export type Book = { file: string; sheets: Map<string, Sheet> };

export function sheetFromWorkbook(file: string, wb: XLSX.WorkBook): Map<string, Sheet> {
  const sheets = new Map<string, Sheet>();
  wb.SheetNames.forEach((name, index) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
    const rows: Cell[][] = [];
    for (let r = 0; r <= range.e.r; r++) {
      const row: Cell[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
        const link = cell?.l?.Target;
        row.push(link ? { v: cell.v, link } : { v: cell?.v });
      }
      rows.push(row);
    }
    const hidden = (wb.Workbook?.Sheets?.[index]?.Hidden ?? 0) !== 0;
    sheets.set(name, { file, name, hidden, rows });
  });
  return sheets;
}

/** `sourceId` (bench, calc…) is used in legacy_ref instead of the file name, which may change. */
export function readBook(path: string, sourceId: string): Book {
  const wb = XLSX.read(readFileSync(path), { cellFormula: false, cellHTML: false });
  return { file: sourceId, sheets: sheetFromWorkbook(sourceId, wb) };
}

export type LegacyBooks = {
  bench: Book | null;
  calc: Book | null;
  /** Optional: imported when present (stage 3). */
  ledger: Book | null;
  acts: Book | null;
  missing: string[];
};

const PATTERNS = {
  bench: /bench/i,
  calc: /calculations/i,
  ledger: /ledger/i,
  acts: /реестр|реєстр|acts/i,
} as const;

/** Finds the source workbooks by name; trips are read in a later stage. */
export function loadBooks(dir: string): LegacyBooks {
  const files = readdirSync(dir).filter(
    (f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'),
  );
  const pick = (re: RegExp) => files.find((f) => re.test(f)) ?? null;
  const bench = pick(PATTERNS.bench);
  const calc = pick(PATTERNS.calc);
  const ledger = pick(PATTERNS.ledger);
  const acts = pick(PATTERNS.acts);
  return {
    bench: bench ? readBook(join(dir, bench), 'bench') : null,
    calc: calc ? readBook(join(dir, calc), 'calc') : null,
    ledger: ledger ? readBook(join(dir, ledger), 'ledger') : null,
    acts: acts ? readBook(join(dir, acts), 'acts') : null,
    missing: [!bench && 'Bench', !calc && 'Calculations for invoices'].filter(
      (x): x is string => typeof x === 'string',
    ),
  };
}

export function cellAt(sheet: Sheet, r: number, c: number): Cell {
  return sheet.rows[r]?.[c] ?? { v: undefined };
}

/** `calc:July:R14` style reference kept in `legacy_ref` and the report. */
export function ref(sheet: Sheet, rowIndex: number): string {
  return `${sheet.file}:${sheet.name}:R${rowIndex + 1}`;
}
