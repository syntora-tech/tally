import { slugify, toDecimal } from '@tally/domain';
import { z } from 'zod';
import { nameKey } from './cells';
import type { BenchRow } from './sources/bench';
import type { CalcRow } from './sources/calc';
import type { ActHeader, InvoiceHeader } from './sources/headers';

const nameList = z.array(z.string()).default([]);

/**
 * Owner-confirmed mapping of names in the files to entities (spec 8, A15). Keys are stable slugs
 * used in legacy_ref, so renaming a person later does not duplicate them on re-import.
 */
export const aliasesSchema = z.object({
  people: z.record(
    z.string(),
    z.object({
      fullName: z.string().min(1),
      /** Spellings in Bench and calculation sheets, e.g. "  Vladyslav ", "Vlad B.". */
      names: nameList,
    }),
  ),
  clients: z.record(
    z.string(),
    z.object({
      legalName: z.string().min(1),
      shortName: z.string().optional(),
      /** "Partner company" values in the calculation sheets. */
      partnerNames: nameList,
      /** Invoice sheets with requisites and the contract, e.g. "SOW #1", "IdeaSoft Annex 3". */
      invoiceSheets: nameList,
    }),
  ),
  payees: z.record(
    z.string(),
    z.object({
      actSheet: z.string(),
      /** Person this FOP belongs to, if any (payee is not always the same human, spec 3). */
      person: z.string().optional(),
      /** People whose default payee this is. */
      defaultFor: nameList,
    }),
  ),
  internalPartners: z.array(z.string()).default(['Syntora.Tech']),
  /** A5: rows that are company expenses, not people. */
  expenseNames: z.array(z.string()).default(['Services', 'Red Jumpers']),
  /** Rows whose "employee" is not a person (e.g. a subcontracting team). */
  skipEmployees: nameList,
  /** A2/A3: proration of fixed monthly billing; default is by_hours. */
  prorationOverrides: z
    .array(
      z.object({
        client: z.string(),
        person: z.string().optional(),
        policy: z.enum(['full_month', 'by_hours', 'trunc_hourly']),
      }),
    )
    .default([]),
});

export type Aliases = z.infer<typeof aliasesSchema>;

export type Lookup = {
  person(name: string): string | null;
  partner(
    name: string,
  ): { kind: 'internal' } | { kind: 'expense' } | { kind: 'client'; key: string } | null;
  isSkippedEmployee(name: string): boolean;
  isExpense(name: string): boolean;
};

export function lookup(aliases: Aliases): Lookup {
  const people = new Map<string, string>();
  for (const [key, p] of Object.entries(aliases.people)) {
    for (const n of [...p.names, p.fullName]) people.set(nameKey(n), key);
  }
  const partners = new Map<string, string>();
  for (const [key, c] of Object.entries(aliases.clients)) {
    for (const n of c.partnerNames) partners.set(nameKey(n), key);
  }
  const internal = new Set(aliases.internalPartners.map(nameKey));
  const expense = new Set(aliases.expenseNames.map(nameKey));
  const skipped = new Set(aliases.skipEmployees.map(nameKey));
  return {
    person: (name) => people.get(nameKey(name)) ?? null,
    partner: (name) => {
      const k = nameKey(name);
      if (internal.has(k)) return { kind: 'internal' };
      if (expense.has(k)) return { kind: 'expense' };
      const key = partners.get(k);
      return key ? { kind: 'client', key } : null;
    },
    isSkippedEmployee: (name) => skipped.has(nameKey(name)),
    isExpense: (name) => expense.has(nameKey(name)),
  };
}

const firstToken = (s: string) => nameKey(s).replace(/\./g, '').split(' ')[0] ?? '';

/**
 * Draft aliases from the files: one person per distinct name, calc names merged into a Bench name
 * with the same unique first name, clients derived from invoice sheets via SOW/Annex references.
 * Everything here is a guess for the owner to review and save as aliases.json.
 */
export function draftAliases(input: {
  bench: BenchRow[];
  calc: CalcRow[];
  invoices: InvoiceHeader[];
  acts: ActHeader[];
}): Aliases {
  const people: Aliases['people'] = {};
  const byFirst = new Map<string, string[]>();
  for (const b of input.bench) {
    const key = slugify(b.name) || 'person';
    people[key] = { fullName: b.name, names: [b.name] };
    byFirst.set(firstToken(b.name), [...(byFirst.get(firstToken(b.name)) ?? []), key]);
  }
  const defaults = aliasesSchema.parse({ people: {}, clients: {}, payees: {} });
  const internal = new Set(defaults.internalPartners.map(nameKey));
  const expense = new Set(defaults.expenseNames.map(nameKey));

  for (const row of input.calc) {
    if (!row.employee || expense.has(nameKey(row.employee)) || expense.has(nameKey(row.partner)))
      continue;
    const already = Object.values(people).some((p) =>
      p.names.some((n) => nameKey(n) === nameKey(row.employee)),
    );
    if (already) continue;
    const candidates = byFirst.get(firstToken(row.employee)) ?? [];
    const target = candidates.length === 1 ? candidates[0] : undefined;
    if (target && people[target]) {
      people[target].names.push(row.employee);
      if (row.employee.length > people[target].fullName.length)
        people[target].fullName = row.employee.trim();
    } else {
      people[slugify(row.employee) || 'person'] = {
        fullName: row.employee.trim(),
        names: [row.employee],
      };
    }
  }

  const clients: Aliases['clients'] = {};
  const partnerBySow = new Map<string, string>();
  for (const row of input.calc) {
    const sow = /STATEMENT OF WORK #(\d+)|SOW #(\d+)|Annex (\d+)/i.exec(row.basedOn);
    if (sow)
      partnerBySow.set(sow[0].toUpperCase().replace('STATEMENT OF WORK', 'SOW'), row.partner);
  }
  for (const inv of input.invoices) {
    const key = slugify(inv.customer.legalName);
    const existing = clients[key];
    const sowKey = inv.sowRef?.toUpperCase();
    const partner =
      (sowKey && partnerBySow.get(sowKey)) ??
      (inv.sowRef?.startsWith('Annex')
        ? [...partnerBySow.entries()].find(([k]) => k.startsWith('ANNEX'))?.[1]
        : undefined);
    if (existing) {
      existing.invoiceSheets.push(inv.sheet);
      if (partner && !existing.partnerNames.includes(partner)) existing.partnerNames.push(partner);
    } else {
      clients[key] = {
        legalName: inv.customer.legalName,
        ...(partner ? { shortName: partner } : {}),
        partnerNames: partner ? [partner] : [],
        invoiceSheets: [inv.sheet],
      };
    }
  }
  const mapped = new Set(Object.values(clients).flatMap((c) => c.partnerNames.map(nameKey)));
  for (const row of input.calc) {
    const k = nameKey(row.partner);
    if (!row.partner || internal.has(k) || expense.has(k) || mapped.has(k)) continue;
    mapped.add(k);
    clients[slugify(row.partner) || 'client'] = {
      legalName: row.partner,
      shortName: row.partner,
      partnerNames: [row.partner],
      invoiceSheets: [],
    };
  }

  const payees: Aliases['payees'] = {};
  for (const act of input.acts) {
    payees[slugify(act.sheet.replace(/^Акт\s+/i, '')) || 'payee'] = {
      actSheet: act.sheet,
      defaultFor: [],
    };
  }

  const skipEmployees = [
    ...new Set(
      input.calc.filter((r) => r.fte !== null && toDecimal(r.fte).gt(1)).map((r) => r.employee),
    ),
  ];
  // A2/A3 from the spec as a starting point: Trady bills the full month, Pavlo × Boosty truncates.
  const clientByPartner = (partner: string) =>
    Object.entries(clients).find(([, c]) =>
      c.partnerNames.some((n) => nameKey(n) === nameKey(partner)),
    )?.[0];
  const personByFirst = (first: string) =>
    Object.entries(people).find(([, p]) => p.names.some((n) => firstToken(n) === first))?.[0];
  const prorationOverrides: Aliases['prorationOverrides'] = [];
  const trady = clientByPartner('Trady');
  if (trady) prorationOverrides.push({ client: trady, policy: 'full_month' });
  const boosty = clientByPartner('Boosty');
  const pavlo = personByFirst('pavlo');
  if (boosty && pavlo)
    prorationOverrides.push({ client: boosty, person: pavlo, policy: 'trunc_hourly' });
  return {
    ...defaults,
    people,
    clients,
    payees,
    skipEmployees,
    prorationOverrides,
  };
}
