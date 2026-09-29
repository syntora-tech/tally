import { parseUaDate, toDecimal, type LocalDate } from '@tally/domain';

export type Cell = { v: unknown; link?: string };

/** Trimmed text with non-breaking spaces and repeated whitespace collapsed. */
export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'string') s = value;
  else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
  else return '';
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Lower-case, single-spaced key for matching names across files (A15). */
export function nameKey(value: unknown): string {
  return text(value).toLowerCase();
}

const EMPTY = new Set(['', '-', '–', '—']);

/**
 * Decimal string from a cell. Excel numbers arrive as JS doubles; `String(n)` gives the shortest
 * round-trip representation (what Excel shows), which then only ever travels as a string.
 */
export function decimal(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return toDecimal(String(value)).toString();
  }
  const s = text(value).replace(/\s/g, '').replace(',', '.');
  if (EMPTY.has(s)) return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? toDecimal(s).toString() : null;
}

/** First `dd.mm.yyyy` inside a string, e.g. "From 01.09.2026". */
export function uaDateIn(value: unknown): LocalDate | null {
  const match = /(\d{2}\.\d{2}\.\d{4})/.exec(text(value));
  if (!match?.[1]) return null;
  const parsed = parseUaDate(match[1]);
  return parsed.isOk() ? parsed.value : null;
}

export function splitList(value: unknown): string[] {
  return [
    ...new Set(
      text(value)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
