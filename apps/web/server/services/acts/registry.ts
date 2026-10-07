import { contract, payee, supplierAct } from '@tally/db/schema';
import { addMonths, startOfMonth, sum, type LocalDate } from '@tally/domain';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { inActorScope } from '../context';
import type { XlsxSheet } from '../../xlsx';
import { defineService } from '../define-service';

const payeeName = sql<string>`coalesce(${payee.legalNameUa}, ${payee.legalNameEn})`;

export const actsRegistryFilters = z.object({
  payeeId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
  year: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : Number(v)),
    z.number().int().min(2000).max(2100).optional(),
  ),
  /** Drafts and void acts are listed too, never counted in totals. */
  all: z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean()),
});

export type ActsRegistryFilters = z.input<typeof actsRegistryFilters>;

export type RegistryAct = {
  id: string;
  number: string | null;
  actDate: string;
  amountUah: string;
  status: 'draft' | 'issued' | 'void';
  type: string;
  periodFrom: string | null;
  periodTo: string | null;
  isLegacy: boolean;
  signed: boolean;
  contractId: string;
  contractNumber: string;
};

export type RegistryGroup = {
  payeeId: string;
  payeeName: string;
  acts: RegistryAct[];
  /** UAH of issued acts. */
  total: string;
  /** Months without a monthly act between the payee's first and last one in the selection (A9). */
  missing: string[];
};

/** Months (`YYYY-MM`) without a monthly act between the first and the last one. */
export function missingMonths(acts: readonly RegistryAct[]): string[] {
  const months = new Set(
    acts
      .filter((a) => a.type === 'monthly' && a.status !== 'void')
      .map((a) => (a.periodFrom ?? startOfMonth(a.actDate as LocalDate)).slice(0, 7)),
  );
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last || first === last) return [];
  const missing: string[] = [];
  for (let m = `${first}-01` as LocalDate; m.slice(0, 7) < last; m = addMonths(m, 1)) {
    if (!months.has(m.slice(0, 7))) missing.push(m.slice(0, 7));
  }
  return missing;
}

export function groupRegistry(
  rows: readonly (RegistryAct & { payeeId: string; payeeName: string })[],
) {
  const groups = new Map<string, RegistryGroup>();
  for (const { payeeId, payeeName: name, ...act } of rows) {
    const group = groups.get(payeeId) ?? {
      payeeId,
      payeeName: name,
      acts: [],
      total: '0',
      missing: [],
    };
    group.acts.push(act);
    groups.set(payeeId, group);
  }
  const list = [...groups.values()].map((g) => ({
    ...g,
    total: sum(g.acts.filter((a) => a.status === 'issued').map((a) => a.amountUah)).toFixed(2),
    missing: missingMonths(g.acts),
  }));
  return {
    groups: list,
    total: sum(list.map((g) => g.total)).toFixed(2),
    count: list.reduce((n, g) => n + g.acts.filter((a) => a.status === 'issued').length, 0),
  };
}

/**
 * Supplier acts registry (6.6, A-087): the `Реестр актов Поставщики` sheet — acts grouped by
 * counterparty in date order with a subtotal each. Only issued acts by default.
 */
export const actsRegistry = defineService({
  name: 'acts.registry',
  input: actsRegistryFilters,
  handler: async (ctx, { payeeId, year, all }) => {
    const [rows, payees] = await inActorScope(ctx, (tx) =>
      Promise.all([
        tx
          .select({
            id: supplierAct.id,
            number: supplierAct.number,
            actDate: supplierAct.actDate,
            amountUah: supplierAct.amountUah,
            status: supplierAct.status,
            type: supplierAct.type,
            periodFrom: supplierAct.periodFrom,
            periodTo: supplierAct.periodTo,
            isLegacy: supplierAct.isLegacy,
            signed: sql<boolean>`${supplierAct.signedUrl} is not null`,
            contractId: supplierAct.contractId,
            contractNumber: contract.number,
            payeeId: supplierAct.payeeId,
            payeeName,
          })
          .from(supplierAct)
          .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
          .innerJoin(contract, eq(contract.id, supplierAct.contractId))
          .where(
            and(
              payeeId ? eq(supplierAct.payeeId, payeeId) : undefined,
              year ? gte(supplierAct.actDate, `${String(year)}-01-01`) : undefined,
              year ? lt(supplierAct.actDate, `${String(year + 1)}-01-01`) : undefined,
              all ? undefined : inArray(supplierAct.status, ['issued']),
            ),
          )
          .orderBy(asc(payeeName), asc(supplierAct.actDate), asc(supplierAct.number)),
        tx
          .selectDistinct({ payeeId: supplierAct.payeeId, payeeName })
          .from(supplierAct)
          .innerJoin(payee, eq(payee.id, supplierAct.payeeId))
          .orderBy(asc(payeeName)),
      ]),
    );
    return ok({ ...groupRegistry(rows), payees });
  },
});

/**
 * The registry as the accountant's sheet: a row per issued act, a SUM row under each counterparty
 * and a grand total. Headers stay Ukrainian like the original sheet.
 */
export function actsRegistrySheet(groups: readonly RegistryGroup[]): XlsxSheet {
  const rows: XlsxSheet['rows'] = [
    [
      { s: 'Контрагент', bold: true },
      { s: 'Дата акта', bold: true },
      { s: 'Номер акта', bold: true },
      { s: 'Сума акта', bold: true },
    ],
  ];
  const subtotals: string[] = [];
  for (const group of groups) {
    const issued = group.acts.filter((a) => a.status === 'issued');
    if (issued.length === 0) continue;
    const first = rows.length + 1;
    for (const act of issued) {
      rows.push([
        { s: group.payeeName },
        { date: act.actDate },
        { s: act.number ?? '' },
        { n: act.amountUah },
      ]);
    }
    const range = `D${String(first)}:D${String(rows.length)}`;
    rows.push([null, null, null, { n: group.total, bold: true, formula: `SUM(${range})` }]);
    subtotals.push(`D${String(rows.length)}`);
    rows.push([]);
  }
  if (subtotals.length > 1) {
    const total = sum(groups.map((g) => g.total)).toFixed(2);
    rows.push([
      { s: 'Разом', bold: true },
      null,
      null,
      { n: total, bold: true, formula: subtotals.join('+') },
    ]);
  }
  return { name: 'ФОПи акти', widths: [40, 12, 16, 16], rows };
}
