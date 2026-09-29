import type { Db, DbTransaction } from '@tally/db';
import {
  assignment,
  billingTerms,
  client,
  company,
  contract,
  document,
  documentLink,
  payee,
  payTerms,
  period,
  person,
  timesheet,
} from '@tally/db/schema';
import { parseDecimal } from '@tally/domain';
import { asc, eq, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Model } from './model';

export type TableStats = { inserted: number; updated: number; unchanged: number };
export type WriteStats = Record<string, TableStats>;

class DryRunRollback extends Error {}

function statFor(stats: WriteStats, name: string): TableStats {
  return (stats[name] ??= { inserted: 0, updated: 0, unchanged: 0 });
}

/** DB values vs model values: decimals by value, arrays/objects by JSON, the rest as strings. */
export function same(dbValue: unknown, value: unknown): boolean {
  if ((dbValue === null || dbValue === undefined) && (value === null || value === undefined))
    return true;
  if (typeof dbValue === 'string' && typeof value === 'string') {
    const a = parseDecimal(dbValue);
    const b = parseDecimal(value);
    if (a.isOk() && b.isOk()) return a.value.eq(b.value);
    return dbValue === value;
  }
  if (typeof dbValue === 'object' || typeof value === 'object') {
    return JSON.stringify(dbValue) === JSON.stringify(value);
  }
  return JSON.stringify(dbValue) === JSON.stringify(value);
}

type Keyed = PgTable & { id: PgColumn; legacyRef: PgColumn };

async function upsert(
  tx: DbTransaction,
  table: Keyed,
  name: string,
  legacyRef: string,
  values: Record<string, unknown>,
  stats: WriteStats,
): Promise<string> {
  const s = statFor(stats, name);
  const [existing] = (await tx
    .select()
    .from(table)
    .where(eq(table.legacyRef, legacyRef))) as Record<string, unknown>[];
  if (!existing) {
    // Drizzle cannot type a table-generic insert; `values` comes from the typed model.
    const [row] = (await tx
      .insert(table)
      .values({ ...values, legacyRef } as never)
      .returning({ id: table.id })) as { id: string }[];
    if (!row) throw new Error(`Insert into ${name} returned no row`);
    s.inserted++;
    return row.id;
  }
  const changed = Object.fromEntries(
    Object.entries(values).filter(([k, v]) => !same(existing[k], v)),
  );
  if (Object.keys(changed).length > 0) {
    await tx
      .update(table)
      .set(changed)
      .where(eq(table.id, existing.id as string));
    s.updated++;
  } else {
    s.unchanged++;
  }
  return existing.id as string;
}

function need(map: Map<string, string>, key: string | null, what: string): string | null {
  if (key === null) return null;
  const id = map.get(key);
  if (!id) throw new Error(`Import: unknown ${what} "${key}"`);
  return id;
}

/**
 * Writes the model in one transaction as `system:import` (spec 8). Idempotent via legacy_ref:
 * a second run over the same files reports only unchanged rows. Dry-run rolls everything back
 * after the DB has validated every constraint.
 */
export async function writeModel(
  db: Db,
  model: Model,
  options: { dryRun: boolean },
): Promise<WriteStats> {
  const stats: WriteStats = {};
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor', 'system:import', true), set_config('app.via', 'import', true)`,
      );

      let [co] = await tx
        .select({ id: company.id })
        .from(company)
        .orderBy(asc(company.createdAt))
        .limit(1);
      if (!co) {
        if (!model.company) throw new Error('No company requisites in Settings or invoice sheets');
        [co] = await tx.insert(company).values(model.company).returning({ id: company.id });
        stats.company = { inserted: 1, updated: 0, unchanged: 0 };
      }
      const companyId = co?.id ?? '';

      const personIds = new Map<string, string>();
      for (const p of model.persons) {
        const { ref, key, ...values } = p;
        personIds.set(key, await upsert(tx, person, 'person', ref, values, stats));
      }

      const payeeIds = new Map<string, string>();
      for (const p of model.payees) {
        const { ref, key, personKey, ...values } = p;
        payeeIds.set(
          key,
          await upsert(
            tx,
            payee,
            'payee',
            ref,
            { ...values, kind: 'fop', personId: need(personIds, personKey, 'person') },
            stats,
          ),
        );
      }
      for (const d of model.defaultPayees) {
        await tx
          .update(person)
          .set({ defaultPayeeId: need(payeeIds, d.payeeKey, 'payee') })
          .where(eq(person.id, need(personIds, d.personKey, 'person') ?? ''));
      }

      const clientIds = new Map<string, string>();
      for (const c of model.clients) {
        const { ref, key, ...values } = c;
        clientIds.set(key, await upsert(tx, client, 'client', ref, values, stats));
      }

      const contractIds = new Map<string, string>();
      for (const c of model.contracts) {
        const { ref, clientKey, payeeKey, ...values } = c;
        contractIds.set(
          ref,
          await upsert(
            tx,
            contract,
            'contract',
            ref,
            {
              ...values,
              companyId,
              clientId: need(clientIds, clientKey, 'client'),
              payeeId: need(payeeIds, payeeKey, 'payee'),
            },
            stats,
          ),
        );
      }

      const assignmentIds = new Map<string, string>();
      for (const a of model.assignments) {
        const { ref, personKey, clientKey: _client, contractRef, months: _months, ...values } = a;
        assignmentIds.set(
          ref,
          await upsert(
            tx,
            assignment,
            'assignment',
            ref,
            {
              ...values,
              personId: need(personIds, personKey, 'person'),
              contractId: need(contractIds, contractRef, 'contract'),
            },
            stats,
          ),
        );
      }
      for (const b of model.billing) {
        const { ref, assignmentRef, ...values } = b;
        await upsert(
          tx,
          billingTerms,
          'billing_terms',
          ref,
          { ...values, assignmentId: need(assignmentIds, assignmentRef, 'assignment') },
          stats,
        );
      }
      for (const p of model.pay) {
        const { ref, assignmentRef, ...values } = p;
        await upsert(
          tx,
          payTerms,
          'pay_terms',
          ref,
          { ...values, assignmentId: need(assignmentIds, assignmentRef, 'assignment') },
          stats,
        );
      }

      // Periods are keyed by month (unique), not legacy_ref; closing stays with the stage-2 wizard.
      const periodIds = new Map<string, string>();
      for (const p of model.periods) {
        const st = statFor(stats, 'period');
        const [existing] = await tx.select().from(period).where(eq(period.month, p.month));
        if (!existing) {
          const [row] = await tx
            .insert(period)
            .values({
              month: p.month,
              workHours: p.workHours,
              referenceFxUsdUah: p.referenceFxUsdUah,
            })
            .returning({ id: period.id });
          if (!row) throw new Error('Period insert returned no row');
          periodIds.set(p.month, row.id);
          st.inserted++;
        } else {
          periodIds.set(p.month, existing.id);
          const changed =
            !same(existing.workHours, p.workHours) ||
            !same(existing.referenceFxUsdUah, p.referenceFxUsdUah);
          if (changed && existing.status === 'open') {
            await tx
              .update(period)
              .set({ workHours: p.workHours, referenceFxUsdUah: p.referenceFxUsdUah })
              .where(eq(period.id, existing.id));
            st.updated++;
          } else {
            st.unchanged++;
          }
        }
      }
      for (const t of model.timesheets) {
        await upsert(
          tx,
          timesheet,
          'timesheet',
          t.ref,
          {
            assignmentId: need(assignmentIds, t.assignmentRef, 'assignment'),
            periodId: need(periodIds, t.month, 'period'),
            hours: t.hours,
            source: 'import',
          },
          stats,
        );
      }

      for (const d of model.documents) {
        const id = await upsert(
          tx,
          document,
          'document',
          d.ref,
          { type: 'cv', title: d.title, url: d.url },
          stats,
        );
        await tx
          .insert(documentLink)
          .values({
            documentId: id,
            entityType: 'person',
            entityId: need(personIds, d.personKey, 'person') ?? '',
          })
          .onConflictDoNothing();
      }

      if (options.dryRun) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return stats;
}
