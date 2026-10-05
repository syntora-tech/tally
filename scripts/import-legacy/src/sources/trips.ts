import { localDate, type LocalDate } from '@tally/domain';
import { decimal, text } from '../cells';
import { cellAt, ref, type Book, type Sheet } from '../workbook';

export type TripRow = {
  ref: string;
  service: string;
  cost: string;
  costUsd: string | null;
  /** "Is compensation required?" */
  compensate: boolean;
  currency: string;
  /** The UAH column, when filled (number or "13,618.26грн."). */
  uah: string | null;
};

export type CardRow = {
  ref: string;
  on: LocalDate;
  details: string;
  note: string;
  uah: string;
  amount: string;
  currency: string;
  rate: string | null;
};

export type TripSheet = {
  sheet: string;
  title: string;
  participant: string;
  /** Units per 1 USD from the sheet header, e.g. { EUR: "0.87", UAH: "44.75" }. */
  rates: Record<string, string>;
  rows: TripRow[];
  cards: CardRow[];
};

/** "13,618.26грн." / "568.76грн." / 30384.79 → decimal string. */
export function hryvnias(value: unknown): string | null {
  if (typeof value === 'number') return decimal(value);
  const s = text(value)
    .replace(/грн\.?/i, '')
    .replace(/,/g, '')
    .trim();
  return decimal(s);
}

/** "21.06.2026\n20:06:57" → 2026-06-21. */
function cardDate(value: unknown): LocalDate | null {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(typeof value === 'string' ? value : '');
  return m ? localDate(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

function findColumn(sheet: Sheet, row: number, pattern: RegExp): number {
  return (sheet.rows[row] ?? []).findIndex((c) => pattern.test(text(c.v)));
}

/**
 * One `Business_trips` sheet (spec 8.1): title and participant on top, the rates block next to
 * them, item rows from row 4, and on the right of some sheets a card statement (date, details,
 * note, UAH, amount, currency, rate).
 */
export function parseTripSheet(sheet: Sheet): TripSheet {
  const rates: Record<string, string> = {};
  const ratesAt = findColumn(sheet, 0, /^exchange rates/i);
  if (ratesAt >= 0) {
    for (let c = ratesAt + 1; c < ratesAt + 4; c++) {
      const currency = text(cellAt(sheet, 0, c).v).toUpperCase();
      const value = decimal(cellAt(sheet, 1, c).v);
      if (/^[A-Z]{3}$/.test(currency) && value) rates[currency] = value;
    }
  }
  const rows: TripRow[] = [];
  for (let r = 3; r < sheet.rows.length; r++) {
    const service = text(cellAt(sheet, r, 0).v);
    const cost = decimal(cellAt(sheet, r, 1).v);
    if (!service || !cost || cost === '0') continue;
    rows.push({
      ref: ref(sheet, r),
      service,
      cost,
      costUsd: decimal(cellAt(sheet, r, 2).v),
      compensate: /^yes$/i.test(text(cellAt(sheet, r, 3).v)),
      currency: text(cellAt(sheet, r, 4).v).toUpperCase() || 'USD',
      uah: hryvnias(cellAt(sheet, r, 5).v),
    });
  }
  const cards: CardRow[] = [];
  const cardAt = findColumn(sheet, 0, /^дата/i);
  if (cardAt >= 0) {
    for (let r = 1; r < sheet.rows.length; r++) {
      const on = cardDate(cellAt(sheet, r, cardAt).v);
      const uah = hryvnias(cellAt(sheet, r, cardAt + 3).v);
      const amount = decimal(cellAt(sheet, r, cardAt + 4).v);
      if (!on || !uah || !amount) continue;
      cards.push({
        ref: `${ref(sheet, r)}:card`,
        on,
        details: text(cellAt(sheet, r, cardAt + 1).v),
        note: text(cellAt(sheet, r, cardAt + 2).v),
        uah,
        amount,
        currency: text(cellAt(sheet, r, cardAt + 5).v).toUpperCase(),
        rate: decimal(cellAt(sheet, r, cardAt + 6).v),
      });
    }
  }
  return {
    sheet: sheet.name,
    title: text(cellAt(sheet, 0, 1).v) || sheet.name,
    participant: text(cellAt(sheet, 1, 1).v),
    rates,
    rows,
    cards,
  };
}

export function parseTrips(book: Book): TripSheet[] {
  return [...book.sheets.values()].map(parseTripSheet);
}
