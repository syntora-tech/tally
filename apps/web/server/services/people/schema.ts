import { z } from 'zod';
import { optionalDecimal, optionalLocalDate, optionalText, requiredText, tagList } from '../fields';

export const ALLOCATIONS = ['full_time', 'part_time'] as const;
export const PERSON_STATUSES = ['active', 'bench', 'inactive'] as const;
export const BENCH_STATUSES = ['free', 'partial', 'busy'] as const;

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

/** Profile fields shared by create/update forms and the MCP `upsert_person_profile` tool later. */
export const personProfileInput = z.object({
  fullName: requiredText('people.fullName'),
  displayName: optionalText,
  position: optionalText,
  seniority: tagList,
  stack: tagList,
  domains: tagList,
  marketRateUsd: optionalDecimal,
  allocation: z
    .preprocess(emptyToUndefined, z.enum(ALLOCATIONS).optional())
    .transform((v) => v ?? null),
  availabilityFrom: optionalLocalDate,
  location: optionalText,
  timezone: optionalText,
  contactOwner: optionalText,
  status: z.preprocess(emptyToUndefined, z.enum(PERSON_STATUSES).default('active')),
  notes: optionalText,
});

export type PersonProfileInput = z.output<typeof personProfileInput>;

/** Bench filters (spec 6.2), parsed from URL search params. */
export const peopleFilters = z.object({
  q: optionalText,
  stack: tagList,
  seniority: optionalText,
  maxRate: optionalDecimal,
  availableOn: optionalLocalDate,
  allocation: z
    .preprocess(emptyToUndefined, z.enum(ALLOCATIONS).optional())
    .transform((v) => v ?? null),
  location: optionalText,
  bench: z
    .preprocess(emptyToUndefined, z.enum(BENCH_STATUSES).optional())
    .transform((v) => v ?? null),
  status: z
    .preprocess(emptyToUndefined, z.enum(PERSON_STATUSES).optional())
    .transform((v) => v ?? null),
});

export type PeopleFilters = z.output<typeof peopleFilters>;
