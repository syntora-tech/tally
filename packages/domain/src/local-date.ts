import { err, ok, type Result } from 'neverthrow';

/**
 * Calendar date without time or timezone, ISO `YYYY-MM-DD`.
 * Arithmetic goes through UTC epoch days, so local DST/timezone never shifts a date.
 */
export type LocalDate = string & { readonly __brand: 'LocalDate' };

export type ParseLocalDateError = { code: 'invalid_date'; input: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UA_DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;
const MS_PER_DAY = 86_400_000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function localDate(year: number, month: number, day: number): LocalDate {
  if (!isValidYmd(year, month, day)) {
    throw new Error(`Invalid calendar date: ${year}-${month}-${day}`);
  }
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}` as LocalDate;
}

export function parseLocalDate(input: string): Result<LocalDate, ParseLocalDateError> {
  const m = ISO_DATE.exec(input.trim());
  if (!m) return err({ code: 'invalid_date', input });
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isValidYmd(y, mo, d)) return err({ code: 'invalid_date', input });
  return ok(localDate(y, mo, d));
}

/** Parses the UI format `ДД.ММ.РРРР`. */
export function parseUaDate(input: string): Result<LocalDate, ParseLocalDateError> {
  const m = UA_DATE.exec(input.trim());
  if (!m) return err({ code: 'invalid_date', input });
  return parseLocalDate(`${m[3] ?? ''}-${m[2] ?? ''}-${m[1] ?? ''}`).mapErr(() => ({
    code: 'invalid_date' as const,
    input,
  }));
}

export function toParts(date: LocalDate): { year: number; month: number; day: number } {
  const [y = '', m = '', d = ''] = date.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}

function toEpochDay(date: LocalDate): number {
  const { year, month, day } = toParts(date);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromEpochDay(epochDay: number): LocalDate {
  const dt = new Date(epochDay * MS_PER_DAY);
  return localDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** `b - a` in calendar days. */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

/** ISO day of week: 1 = Monday … 7 = Sunday (matches Postgres `isodow`). */
export function isoDayOfWeek(date: LocalDate): number {
  // 1970-01-01 was a Thursday (isodow 4).
  return ((((toEpochDay(date) + 3) % 7) + 7) % 7) + 1;
}

export function isWeekend(date: LocalDate): boolean {
  return isoDayOfWeek(date) >= 6;
}

export function compareLocalDate(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function startOfMonth(date: LocalDate): LocalDate {
  const { year, month } = toParts(date);
  return localDate(year, month, 1);
}

export function endOfMonth(date: LocalDate): LocalDate {
  const { year, month } = toParts(date);
  return localDate(year, month, daysInMonth(year, month));
}

/** First day of the month `months` away from the month of `date`. */
export function addMonths(date: LocalDate, months: number): LocalDate {
  const { year, month } = toParts(date);
  const index = year * 12 + (month - 1) + months;
  return localDate(Math.floor(index / 12), (index % 12) + 1, 1);
}

/** `ДД.ММ.РРРР` for the UI and documents. */
export function formatUaDate(date: LocalDate): string {
  const { year, month, day } = toParts(date);
  return `${pad(day)}.${pad(month)}.${pad(year, 4)}`;
}

/** The calendar date of `instant` in `timeZone` — the only bridge from a wall clock to LocalDate. */
export function localDateInZone(instant: Date, timeZone = 'Europe/Kyiv'): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return localDate(get('year'), get('month'), get('day'));
}
