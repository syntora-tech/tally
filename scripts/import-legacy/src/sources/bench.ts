import type { LocalDate } from '@tally/domain';
import { decimal, splitList, text, uaDateIn } from '../cells';
import { cellAt, ref, type Sheet } from '../workbook';

export type BenchRow = {
  ref: string;
  name: string;
  position: string | null;
  seniority: string[];
  stack: string[];
  domains: string[];
  allocation: 'full_time' | 'part_time' | null;
  marketRateUsd: string | null;
  availabilityFrom: LocalDate | null;
  location: string | null;
  timezone: string | null;
  cv: { title: string; url: string | null } | null;
  contactOwner: string | null;
};

const HEADERS = [
  'name',
  'position',
  'seniority',
  'core tech stack',
  'web3 / domain focus',
  'allocation',
  'rate (usd/h)',
  'availability',
  'location',
  'cv',
  'contact person',
] as const;

/** "Ukraine, UTC+3" → location Ukraine, timezone UTC+3; "Portugal, UTC +1" is normalized too. */
export function splitLocation(value: unknown): {
  location: string | null;
  timezone: string | null;
} {
  const parts = splitList(value);
  const tz = parts.find((p) => /^utc\s*[+-−]\s*\d+/i.test(p));
  const location = parts.filter((p) => p !== tz).join(', ');
  return {
    location: location || null,
    timezone: tz ? tz.replace(/\s+/g, '').replace('−', '-').toUpperCase() : null,
  };
}

/** Bench sheet (spec 8.1): one row per specialist; the header row is validated. */
export function parseBench(sheet: Sheet): { rows: BenchRow[]; problems: string[] } {
  const header = (sheet.rows[0] ?? []).slice(0, HEADERS.length).map((c) => text(c.v).toLowerCase());
  const problems = HEADERS.flatMap((h, i) =>
    header[i] === h ? [] : [`Bench: колонка ${i + 1} має бути «${h}», а не «${header[i] ?? ''}»`],
  );
  if (problems.length) return { rows: [], problems };

  const rows: BenchRow[] = [];
  for (let r = 1; r < sheet.rows.length; r++) {
    const at = (c: number) => cellAt(sheet, r, c);
    const name = text(at(0).v);
    if (!name) continue;
    const allocation = text(at(5).v).toLowerCase();
    const availability = text(at(7).v);
    const cvText = text(at(9).v);
    const cvUrl = at(9).link ?? (/^https?:\/\//.test(cvText) ? cvText : null);
    rows.push({
      ref: ref(sheet, r),
      name,
      position: text(at(1).v) || null,
      seniority: splitList(at(2).v),
      stack: splitList(at(3).v),
      domains: splitList(at(4).v),
      allocation: allocation.startsWith('full')
        ? 'full_time'
        : allocation.startsWith('part')
          ? 'part_time'
          : null,
      marketRateUsd: decimal(at(6).v),
      availabilityFrom: /^available$/i.test(availability) ? null : uaDateIn(availability),
      ...splitLocation(at(8).v),
      cv: !cvText || /being updated/i.test(cvText) ? null : { title: cvText, url: cvUrl },
      contactOwner: text(at(10).v) || null,
    });
  }
  return { rows, problems };
}
