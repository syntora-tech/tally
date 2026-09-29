import { parseLocalDate } from '@tally/domain';
import { describe, expect, it } from 'vitest';
import type { PersonRow } from '.';
import { benchCsv } from './export';

const today = parseLocalDate('2026-09-29')._unsafeUnwrap();

const base: PersonRow = {
  id: '1',
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  fullName: 'Andrii Hrytsenko',
  displayName: 'Andrii H.',
  position: 'DevOps Engineer',
  seniority: ['Lead', 'Senior'],
  stack: ['AWS', 'Kubernetes'],
  domains: ['DevOps / SRE'],
  marketRateUsd: '60.00000000',
  allocation: 'part_time',
  availabilityFrom: null,
  location: 'Ukraine',
  timezone: 'UTC+3',
  contactOwner: '@alina_syntora',
  status: 'active',
  defaultPayeeId: 'payee-uuid',
  notes: 'internal note',
  load: '0',
  bench: 'free',
};

describe('benchCsv (spec 6.2 export)', () => {
  const csv = benchCsv(
    [
      base,
      { ...base, id: '2', displayName: null, fullName: 'Vlad P.', availabilityFrom: '2026-11-01' },
    ],
    today,
  );

  it('contains profile fields with the client-facing header', () => {
    const [header, first, second] = csv.replace('\uFEFF', '').trim().split('\r\n');
    expect(header).toBe(
      'Name,Position,Seniority,Core Tech Stack,Web3 / Domain Focus,Allocation,Availability,Location',
    );
    expect(first).toBe(
      'Andrii H.,DevOps Engineer,"Lead, Senior","AWS, Kubernetes",DevOps / SRE,Part time,Available,"Ukraine, UTC+3"',
    );
    expect(second).toContain('From 01.11.2026');
  });

  it('never leaks rates, notes, contacts or payee', () => {
    expect(csv).not.toMatch(/60\.0|internal note|alina|payee-uuid|Rate/i);
  });
});
