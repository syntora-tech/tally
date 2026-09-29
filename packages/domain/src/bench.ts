import { compareLocalDate, type LocalDate } from './local-date';
import { sum, type Decimal, type DecimalInput } from './money';

export type AssignmentLoad = {
  fte: DecimalInput;
  isInternal: boolean;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
};

export type BenchStatus = 'free' | 'partial' | 'busy';

export function isAssignmentActive(
  a: Pick<AssignmentLoad, 'startsOn' | 'endsOn'>,
  on: LocalDate,
): boolean {
  return (
    compareLocalDate(a.startsOn, on) <= 0 && (!a.endsOn || compareLocalDate(a.endsOn, on) >= 0)
  );
}

/** Bench status = total FTE of active non-internal assignments on a date (spec 6.2). */
export function benchStatus(
  assignments: readonly AssignmentLoad[],
  on: LocalDate,
): { status: BenchStatus; load: Decimal } {
  const load = sum(
    assignments.filter((a) => !a.isInternal && isAssignmentActive(a, on)).map((a) => a.fte),
  );
  const status: BenchStatus = load.isZero() ? 'free' : load.lt(1) ? 'partial' : 'busy';
  return { status, load };
}
