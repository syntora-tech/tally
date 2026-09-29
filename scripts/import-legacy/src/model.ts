import { endOfMonth, slugify, toDecimal, weekdayHoursInMonth, type LocalDate } from '@tally/domain';
import { lookup, type Aliases } from './aliases';
import { nameKey } from './cells';
import type { BenchRow } from './sources/bench';
import type { CalcRow } from './sources/calc';
import { MONTH_SHEETS } from './sources/calc';
import type { ActHeader, InvoiceHeader } from './sources/headers';

export type Anomaly = { code: string; ref: string; message: string };

export type PersonRec = {
  ref: string;
  key: string;
  fullName: string;
  displayName: string | null;
  position: string | null;
  seniority: string[];
  stack: string[];
  domains: string[];
  marketRateUsd: string | null;
  allocation: 'full_time' | 'part_time' | null;
  availabilityFrom: LocalDate | null;
  location: string | null;
  timezone: string | null;
  contactOwner: string | null;
};

export type ClientRec = {
  ref: string;
  key: string;
  legalName: string;
  shortName: string | null;
  address: string | null;
  bankDetails: string | null;
};

export type PayeeRec = {
  ref: string;
  key: string;
  legalNameUa: string;
  taxId: string | null;
  addressUa: string | null;
  iban: string | null;
  bankName: string | null;
  edrRecord: string | null;
  edrDate: LocalDate | null;
  personKey: string | null;
};

export type ContractRec = {
  ref: string;
  kind: 'client' | 'fop';
  number: string;
  signedOn: LocalDate | null;
  clientKey: string | null;
  payeeKey: string | null;
  currency: string;
};

export type AssignmentRec = {
  ref: string;
  personKey: string;
  clientKey: string | null;
  contractRef: string | null;
  isInternal: boolean;
  sowRef: string | null;
  roleTitle: string | null;
  fte: string;
  startsOn: LocalDate;
  endsOn: LocalDate | null;
  months: LocalDate[];
};

export type BillingRec = {
  ref: string;
  assignmentRef: string;
  validFrom: LocalDate;
  type: 'fixed_monthly' | 'hourly' | 'none';
  rate: string;
  currency: string;
  prorationPolicy: 'full_month' | 'by_hours' | 'trunc_hourly';
  invoiceChannel: 'fiat' | 'crypto';
};

export type PayRec = {
  ref: string;
  assignmentRef: string;
  validFrom: LocalDate;
  type: 'fixed' | 'hourly' | 'included';
  amount: string;
  currency: string;
  payoutMethod: 'fiat' | 'crypto';
};

export type CompanyRec = {
  nameEn: string;
  nameUa: string;
  legalCode: string | null;
  addressEn: string | null;
  addressUa: string | null;
  directorEn: string | null;
  directorUa: string | null;
  bankDetailsEn: string | null;
};

export type DocumentRec = { ref: string; title: string; url: string | null; personKey: string };

export type Model = {
  company: CompanyRec | null;
  persons: PersonRec[];
  clients: ClientRec[];
  payees: PayeeRec[];
  contracts: ContractRec[];
  defaultPayees: { personKey: string; payeeKey: string }[];
  assignments: AssignmentRec[];
  billing: BillingRec[];
  pay: PayRec[];
  documents: DocumentRec[];
  periods: PeriodRec[];
  timesheets: TimesheetRec[];
  anomalies: Anomaly[];
  unmapped: { people: string[]; partners: string[]; actSheets: string[]; invoiceSheets: string[] };
};

export type PeriodRec = { month: LocalDate; workHours: string; referenceFxUsdUah: string | null };
export type TimesheetRec = { ref: string; assignmentRef: string; month: LocalDate; hours: string };

export type BuildOptions = {
  /** Months whose hours are imported (owner decision: only the current and previous month). */
  hoursMonths?: readonly LocalDate[];
};

export type Sources = {
  bench: BenchRow[];
  calc: CalcRow[];
  invoices: InvoiceHeader[];
  acts: ActHeader[];
};

const LAST_MONTH = MONTH_SHEETS.Current ?? '2026-09-01';
/** Hourly rates above this are treated as data errors (e.g. 4 000 $/h in Current). */
const SUSPICIOUS_HOURLY_RATE = toDecimal('500');

function sowRefOf(basedOn: string): string | null {
  const m = /STATEMENT OF WORK #(\d+)|SOW #(\d+)|Annex (\d+)/i.exec(basedOn);
  if (!m) return null;
  if (m[3]) return `Annex ${m[3]}`;
  return `SOW #${m[1] ?? m[2] ?? ''}`;
}

export function buildModel(src: Sources, aliases: Aliases, options: BuildOptions = {}): Model {
  const hoursMonths = new Set(options.hoursMonths ?? []);
  const assignmentOfRow = new Map<string, string>();
  const find = lookup(aliases);
  const anomalies: Anomaly[] = [];
  const unmapped = {
    people: new Set<string>(),
    partners: new Set<string>(),
    actSheets: new Set<string>(),
    invoiceSheets: new Set<string>(),
  };

  // People: aliases define who exists; Bench rows add profile data.
  const persons = new Map<string, PersonRec>();
  for (const [key, p] of Object.entries(aliases.people)) {
    persons.set(key, {
      ref: `person:${key}`,
      key,
      fullName: p.fullName.trim(),
      displayName: null,
      position: null,
      seniority: [],
      stack: [],
      domains: [],
      marketRateUsd: null,
      allocation: null,
      availabilityFrom: null,
      location: null,
      timezone: null,
      contactOwner: null,
    });
  }
  const benchSeen = new Map<string, string>();
  const documents: DocumentRec[] = [];
  for (const b of src.bench) {
    const key = find.person(b.name);
    const target = key ? persons.get(key) : undefined;
    if (!key || !target) {
      unmapped.people.add(b.name);
      continue;
    }
    if (benchSeen.has(key)) {
      anomalies.push({
        code: 'bench_duplicate',
        ref: b.ref,
        message: `Рядок Bench «${b.name}» теж зіставлено з ${key} (перший — ${benchSeen.get(key) ?? ''})`,
      });
      continue;
    }
    benchSeen.set(key, b.ref);
    Object.assign(target, {
      displayName: nameKey(b.name) === nameKey(target.fullName) ? null : b.name,
      position: b.position,
      seniority: b.seniority,
      stack: b.stack,
      domains: b.domains,
      marketRateUsd: b.marketRateUsd,
      allocation: b.allocation,
      availabilityFrom: b.availabilityFrom,
      location: b.location,
      timezone: b.timezone,
      contactOwner: b.contactOwner,
    });
    if (b.cv)
      documents.push({ ref: `bench:${key}:cv`, title: b.cv.title, url: b.cv.url, personKey: key });
  }

  // Clients and their contracts from invoice sheets.
  const invoiceBySheet = new Map(src.invoices.map((i) => [i.sheet, i]));
  const clients: ClientRec[] = [];
  const contracts = new Map<string, ContractRec>();
  const clientContract = new Map<string, string>();
  for (const [key, c] of Object.entries(aliases.clients)) {
    const invoices = c.invoiceSheets
      .map((s) => {
        const inv = invoiceBySheet.get(s);
        if (!inv) unmapped.invoiceSheets.add(s);
        return inv;
      })
      .filter((i): i is InvoiceHeader => Boolean(i));
    const first = invoices[0];
    clients.push({
      ref: `client:${key}`,
      key,
      legalName: c.legalName,
      shortName: c.shortName ?? null,
      address: first?.customer.address ?? null,
      bankDetails: first?.customer.bankDetails ?? null,
    });
    for (const inv of invoices) {
      if (!inv.contractNumber) continue;
      const ref = `contract:client:${key}:${slugify(inv.contractNumber)}`;
      if (!contracts.has(ref)) {
        contracts.set(ref, {
          ref,
          kind: 'client',
          number: inv.contractNumber,
          signedOn: inv.contractDate,
          clientKey: key,
          payeeKey: null,
          currency: 'USD',
        });
      }
      if (!clientContract.has(key)) clientContract.set(key, ref);
    }
  }

  // FOP payees and contracts from act sheets.
  const actBySheet = new Map(src.acts.map((a) => [a.sheet, a]));
  const payees: PayeeRec[] = [];
  const defaultPayees: Model['defaultPayees'] = [];
  for (const [key, p] of Object.entries(aliases.payees)) {
    const act = actBySheet.get(p.actSheet);
    if (!act?.legalNameUa) {
      unmapped.actSheets.add(p.actSheet);
      continue;
    }
    payees.push({
      ref: `payee:${key}`,
      key,
      legalNameUa: act.legalNameUa,
      taxId: act.taxId,
      addressUa: act.addressUa,
      iban: act.iban,
      bankName: act.bankName,
      edrRecord: act.edrRecord,
      edrDate: act.edrDate,
      personKey: p.person ?? null,
    });
    for (const field of ['iban', 'taxId', 'addressUa'] as const) {
      if (!act[field])
        anomalies.push({
          code: 'payee_field_missing',
          ref: act.ref,
          message: `${act.legalNameUa}: не знайдено ${field} — заповніть у картці одержувача`,
        });
    }
    if (act.contractNumber) {
      const ref = `contract:fop:${key}:${slugify(act.contractNumber)}`;
      contracts.set(ref, {
        ref,
        kind: 'fop',
        number: act.contractNumber,
        signedOn: act.contractDate,
        clientKey: null,
        payeeKey: key,
        currency: 'UAH',
      });
    }
    for (const person of p.defaultFor) defaultPayees.push({ personKey: person, payeeKey: key });
  }

  // Assignments and term versions from the monthly sheets.
  type Group = { personKey: string; clientKey: string | null; role: string; rows: CalcRow[] };
  const groups = new Map<string, Group>();
  for (const row of src.calc) {
    if (find.isExpense(row.employee) || find.isExpense(row.partner)) {
      anomalies.push({
        code: 'A5',
        ref: row.ref,
        message: `«${row.employee} / ${row.partner}» — витрата, не ЗП; не імпортується як assignment (Q6)`,
      });
      continue;
    }
    if (find.isSkippedEmployee(row.employee)) {
      anomalies.push({
        code: 'not_a_person',
        ref: row.ref,
        message: `«${row.employee}» × ${row.partner}: не людина (FTE ${row.fte ?? '—'}), рядок пропущено`,
      });
      continue;
    }
    const personKey = find.person(row.employee);
    const partner = find.partner(row.partner);
    if (!personKey) unmapped.people.add(row.employee);
    if (!partner) unmapped.partners.add(row.partner);
    if (!personKey || !partner || partner.kind === 'expense') continue;
    const clientKey = partner.kind === 'client' ? partner.key : null;
    const role = row.role || '—';
    const key = `calc:${personKey}:${clientKey ?? 'internal'}:${slugify(role)}`;
    const g = groups.get(key) ?? { personKey, clientKey, role, rows: [] };
    g.rows.push(row);
    assignmentOfRow.set(row.ref, key);
    groups.set(key, g);
  }

  const assignments: AssignmentRec[] = [];
  const billing: BillingRec[] = [];
  const pay: PayRec[] = [];
  const policyFor = (clientKey: string | null, personKey: string) =>
    aliases.prorationOverrides.find((o) => o.client === clientKey && o.person === personKey)
      ?.policy ??
    aliases.prorationOverrides.find((o) => o.client === clientKey && !o.person)?.policy ??
    'by_hours';

  for (const [ref, g] of groups) {
    const rows = [...g.rows].sort((a, b) => a.month.localeCompare(b.month));
    const months = [...new Set(rows.map((r) => r.month))];
    const first = months[0];
    const last = months.at(-1);
    if (!first || !last) continue;
    const allMonths = Object.values(MONTH_SHEETS).filter((m) => m >= first && m <= last);
    if (allMonths.length !== months.length) {
      anomalies.push({
        code: 'gap',
        ref: rows[0]?.ref ?? ref,
        message: `${g.personKey} × ${g.clientKey ?? 'internal'} (${g.role}): пропущені місяці між ${first.slice(0, 7)} і ${last.slice(0, 7)}`,
      });
    }
    const ftes = [...new Set(rows.map((r) => r.fte).filter((f): f is string => f !== null))];
    if (ftes.length > 1) {
      anomalies.push({
        code: 'fte_changed',
        ref: rows.at(-1)?.ref ?? ref,
        message: `${g.personKey} × ${g.clientKey ?? 'internal'}: FTE змінювався (${ftes.join(' → ')}), взято останнє`,
      });
    }
    const fte = rows.at(-1)?.fte ?? ftes.at(-1) ?? '1';
    const sow =
      rows
        .map((r) => sowRefOf(r.basedOn))
        .filter(Boolean)
        .at(-1) ?? null;
    const contractRef = g.clientKey
      ? (clientContract.get(g.clientKey) ?? `contract:client:${g.clientKey}:legacy`)
      : null;
    if (g.clientKey && !clientContract.has(g.clientKey) && !contracts.has(contractRef ?? '')) {
      contracts.set(contractRef ?? '', {
        ref: contractRef ?? '',
        kind: 'client',
        number: 'б/н (імпорт)',
        signedOn: null,
        clientKey: g.clientKey,
        payeeKey: null,
        currency: 'USD',
      });
      anomalies.push({
        code: 'no_contract',
        ref: rows[0]?.ref ?? ref,
        message: `Клієнт ${g.clientKey}: договір у файлах не знайдено, створено «б/н (імпорт)» — уточніть номер`,
      });
    }
    assignments.push({
      ref,
      personKey: g.personKey,
      clientKey: g.clientKey,
      contractRef,
      isInternal: g.clientKey === null,
      sowRef: sow,
      roleTitle: g.role === '—' ? null : g.role,
      fte: toDecimal(fte).gt(1) ? '1' : fte,
      startsOn: first,
      endsOn: last < LAST_MONTH ? endOfMonth(last) : null,
      months,
    });

    let prevBilling: BillingRec | null = null;
    let prevPay: PayRec | null = null;
    for (const r of rows) {
      const nextBilling = toBilling(r, ref, g, policyFor, anomalies);
      if (nextBilling && !sameTerms(prevBilling, nextBilling)) {
        billing.push(nextBilling);
        prevBilling = nextBilling;
      }
      const nextPay = toPay(r, ref, prevPay, anomalies);
      if (nextPay && !sameTerms(prevPay, nextPay)) {
        pay.push(nextPay);
        prevPay = nextPay;
      }
    }
  }

  // Hours only where an invoice line exists (billing Fix/Hours and h > 0), for the chosen months.
  const periods: PeriodRec[] = [];
  const timesheets: TimesheetRec[] = [];
  for (const month of [...hoursMonths].sort()) {
    const rows = src.calc.filter((r) => r.month === month);
    const first = rows[0];
    if (!first?.workHoursInMonth) {
      anomalies.push({
        code: 'no_work_hours',
        ref: month,
        message: `Немає норми годин для ${month.slice(0, 7)} — години не імпортовано`,
      });
      continue;
    }
    periods.push({
      month,
      workHours: first.workHoursInMonth,
      referenceFxUsdUah: first.exchangeRate,
    });
    const weekdays = String(weekdayHoursInMonth(month));
    if (!toDecimal(first.workHoursInMonth).eq(weekdays)) {
      anomalies.push({
        code: 'work_hours',
        ref: first.ref,
        message: `Норма ${month.slice(0, 7)} у файлі ${first.workHoursInMonth} год, а робочих днів × 8 = ${weekdays}; взято значення з файлу`,
      });
    }
    for (const r of rows) {
      const assignmentRef = assignmentOfRow.get(r.ref);
      const billable = ['fix', 'hours'].includes(r.invoiceType.toLowerCase());
      if (!assignmentRef || !billable || !r.hours || toDecimal(r.hours).lte(0)) continue;
      const ref = `${assignmentRef}:hours:${month}`;
      if (timesheets.some((t) => t.ref === ref)) {
        anomalies.push({
          code: 'duplicate_hours',
          ref: r.ref,
          message: 'Другий рядок годин для того самого залучення в місяці — пропущено',
        });
        continue;
      }
      timesheets.push({ ref, assignmentRef, month, hours: r.hours });
    }
  }

  const supplier = src.invoices.find((i) => i.supplier.nameEn)?.supplier;
  return {
    company:
      supplier?.nameEn && supplier.nameUa
        ? {
            nameEn: supplier.nameEn,
            nameUa: supplier.nameUa,
            legalCode: supplier.legalCode,
            addressEn: supplier.addressEn,
            addressUa: supplier.addressUa,
            directorEn: supplier.directorEn,
            directorUa: supplier.directorUa,
            bankDetailsEn: supplier.bankDetailsEn,
          }
        : null,
    persons: [...persons.values()],
    clients,
    payees,
    contracts: [...contracts.values()],
    defaultPayees,
    assignments,
    billing,
    pay,
    documents,
    periods,
    timesheets,
    anomalies,
    unmapped: {
      people: [...unmapped.people].sort(),
      partners: [...unmapped.partners].sort(),
      actSheets: [...unmapped.actSheets].sort(),
      invoiceSheets: [...unmapped.invoiceSheets].sort(),
    },
  };
}

function sameTerms<T extends { validFrom: string; ref: string }>(a: T | null, b: T): boolean {
  if (!a) return false;
  const strip = ({ validFrom: _v, ref: _r, ...rest }: T) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

function toBilling(
  r: CalcRow,
  assignmentRef: string,
  g: { personKey: string; clientKey: string | null },
  policyFor: (client: string | null, person: string) => BillingRec['prorationPolicy'],
  anomalies: Anomaly[],
): BillingRec | null {
  const base = {
    ref: `${assignmentRef}:billing:${r.month}`,
    assignmentRef,
    validFrom: r.month,
    currency: 'USD',
    invoiceChannel: /crypto/i.test(r.invoiceTo) ? ('crypto' as const) : ('fiat' as const),
  };
  const type = r.invoiceType.toLowerCase();
  if (type === 'skip' || type === '') {
    return { ...base, type: 'none', rate: '0', prorationPolicy: 'full_month' };
  }
  if (type === 'fix') {
    return {
      ...base,
      type: 'fixed_monthly',
      rate: r.monthPayment ?? '0',
      prorationPolicy: policyFor(g.clientKey, g.personKey),
    };
  }
  if (type === 'hours') {
    const rate = r.monthPayment ?? r.hourRate;
    if (!rate) {
      anomalies.push({
        code: 'no_rate',
        ref: r.ref,
        message: 'Погодинний білінг без ставки — версію не створено',
      });
      return null;
    }
    if (toDecimal(rate).gt(SUSPICIOUS_HOURLY_RATE)) {
      anomalies.push({
        code: 'suspicious_rate',
        ref: r.ref,
        message: `Погодинна ставка ${rate} $/год схожа на помилку (сума ${r.monthPayment ?? ''} × ${r.hours ?? ''} год) — версію не створено, діє попередня`,
      });
      return null;
    }
    return { ...base, type: 'hourly', rate, prorationPolicy: 'full_month' };
  }
  anomalies.push({
    code: 'unknown_invoice_type',
    ref: r.ref,
    message: `Невідомий тип інвойсу «${r.invoiceType}»`,
  });
  return null;
}

function toPay(
  r: CalcRow,
  assignmentRef: string,
  prev: PayRec | null,
  anomalies: Anomaly[],
): PayRec | null {
  const payoutMethod = /crypto/i.test(r.prepayment)
    ? ('crypto' as const)
    : /fiat/i.test(r.prepayment)
      ? ('fiat' as const)
      : (prev?.payoutMethod ?? 'fiat');
  const base = {
    ref: `${assignmentRef}:pay:${r.month}`,
    assignmentRef,
    validFrom: r.month,
    currency: 'USD',
    payoutMethod,
  };
  const type = r.payType.toLowerCase();
  if (type === 'included in fix') return { ...base, type: 'included', amount: '0' };
  if (type === 'fix' || type === 'hours') {
    if (!r.fixSalary) {
      anomalies.push({
        code: 'no_salary',
        ref: r.ref,
        message: `Тип виплати «${r.payType}» без суми — версію не створено`,
      });
      return null;
    }
    return { ...base, type: type === 'fix' ? 'fixed' : 'hourly', amount: r.fixSalary };
  }
  if (type !== '')
    anomalies.push({
      code: 'unknown_pay_type',
      ref: r.ref,
      message: `Невідомий тип виплати «${r.payType}»`,
    });
  return null;
}
