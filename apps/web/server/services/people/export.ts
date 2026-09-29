import { formatUaDate, toCsv, type LocalDate } from '@tally/domain';
import type { PersonRow } from '.';

const ALLOCATION: Record<string, string> = { full_time: 'Full time', part_time: 'Part time' };
const BENCH: Record<string, string> = {
  free: 'Available',
  partial: 'Partially available',
  busy: 'Busy',
};

/**
 * Bench CSV for sending to clients (spec 6.2): profile fields only — no rates, notes, contacts
 * or payee data. Headers are in English because the file goes to clients.
 */
export function benchCsv(rows: readonly PersonRow[], today: LocalDate): string {
  return toCsv<PersonRow>(
    [
      { header: 'Name', value: (r) => r.displayName ?? r.fullName },
      { header: 'Position', value: (r) => r.position },
      { header: 'Seniority', value: (r) => r.seniority.join(', ') },
      { header: 'Core Tech Stack', value: (r) => r.stack.join(', ') },
      { header: 'Web3 / Domain Focus', value: (r) => r.domains.join(', ') },
      { header: 'Allocation', value: (r) => (r.allocation ? ALLOCATION[r.allocation] : '') },
      {
        header: 'Availability',
        value: (r) =>
          r.availabilityFrom && r.availabilityFrom > today
            ? `From ${formatUaDate(r.availabilityFrom as LocalDate)}`
            : BENCH[r.bench],
      },
      { header: 'Location', value: (r) => [r.location, r.timezone].filter(Boolean).join(', ') },
    ],
    rows,
  );
}
