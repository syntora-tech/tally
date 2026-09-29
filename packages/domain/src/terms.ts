import { compareLocalDate, type LocalDate } from './local-date';

export type Versioned = { validFrom: LocalDate };

/**
 * The version in force for a period: the greatest `validFrom` ≤ the first day of the period (spec 5).
 * Mid-month changes are not supported in v1, so the period start is the only reference point.
 */
export function effectiveVersion<T extends Versioned>(
  versions: readonly T[],
  periodStart: LocalDate,
): T | null {
  let current: T | null = null;
  for (const v of versions) {
    if (compareLocalDate(v.validFrom, periodStart) > 0) continue;
    if (!current || compareLocalDate(v.validFrom, current.validFrom) > 0) current = v;
  }
  return current;
}
