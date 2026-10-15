/**
 * Removes Playwright/integration leftovers from the LOCAL database (they share it with real data).
 *
 *   pnpm db:purge-e2e            # dry run: prints what would be deleted
 *   pnpm db:purge-e2e --apply    # deletes in one transaction, verifies FK integrity, else rolls back
 *
 * Seeds are rows named like test fixtures (`E2E …`, `unique()` suffixes) and far-future periods,
 * acts and invoices;
 * everything that references them through foreign keys follows. Protected tables are guarded by
 * triggers, so the delete runs with `session_replication_role = replica` — which also disables FK
 * checks, hence the explicit orphan check before commit.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const FIXTURE = String.raw`^E2E|\m(reg|trip|dos|ag|94) [0-9a-z]{7,9}$`;
// Real books start in 2025; e2e and integration tests work in 2030 and later.
const FAR_FUTURE = '2030-01-01';

const SEED_COLUMNS: readonly (readonly [string, string])[] = [
  ['client', 'legal_name'],
  ['person', 'full_name'],
  ['payee', 'legal_name_ua'],
  ['payee', 'legal_name_en'],
  ['contract', 'number'],
  ['document', 'title'],
  ['account', 'name'],
  ['category', 'name'],
  ['trip', 'title'],
  ['planned_expense', 'name'],
  ['planned_payment', 'name'],
  ['payment_charge', 'name'],
  ['mcp_client_policy', 'client_name'],
];

type Fk = { child: string; childCol: string; parent: string; parentCol: string; onDelete: string };

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(import.meta.dirname, '../../../apps/web/.env.local'), 'utf8');
    const match = /^DATABASE_URL=(.*)$/m.exec(env);
    if (match?.[1]) return match[1].trim();
  } catch {
    // fall through to the local default
  }
  return 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

const url = databaseUrl();
const host = new URL(url).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`Refusing to purge a non-local database (${host}).`);
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const fks = await sql<Fk[]>`
    select c.conrelid::regclass::text as child, a.attname as "childCol",
           c.confrelid::regclass::text as parent, pa.attname as "parentCol",
           c.confdeltype as "onDelete"
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace
      and array_length(c.conkey, 1) = 1`;

  const doomed = new Map<string, Set<string>>();
  const keysOf = async (fk: Fk, ids: readonly string[]) =>
    fk.parentCol === 'id'
      ? [...ids]
      : (
          await sql<{ k: string }[]>`
            select ${sql(fk.parentCol)}::text as k from ${sql(fk.parent)} where id::text = any(${ids})`
        ).map((r) => r.k);
  const add = (table: string, ids: readonly string[]) => {
    const set = doomed.get(table) ?? new Set<string>();
    const before = set.size;
    for (const id of ids) set.add(id);
    doomed.set(table, set);
    return set.size > before;
  };

  for (const [table, column] of SEED_COLUMNS) {
    const rows = await sql<{ id: string }[]>`
      select id::text from ${sql(table)} where ${sql(column)} ~ ${FIXTURE}`;
    add(
      table,
      rows.map((r) => r.id),
    );
  }
  for (const [table, column] of [
    ['period', 'month'],
    ['supplier_act', 'act_date'],
    ['invoice', 'issue_date'],
  ] as const) {
    const rows = await sql<{ id: string }[]>`
      select id::text from ${sql(table)} where ${sql(column)} >= ${FAR_FUTURE}`;
    add(
      table,
      rows.map((r) => r.id),
    );
  }

  // Earlier replica-mode test cleanups could delete a parent without its children; such rows
  // point at nothing and are junk too.
  const orphans: { table: string; column: string; rows: number }[] = [];
  for (const fk of fks) {
    const rows = await sql<{ id: string }[]>`
      select ch.id::text from ${sql(fk.child)} ch
      where ch.${sql(fk.childCol)} is not null
        and not exists (select 1 from ${sql(fk.parent)} p where p.${sql(fk.parentCol)} = ch.${sql(fk.childCol)})`;
    if (rows.length) {
      orphans.push({ table: fk.child, column: fk.childCol, rows: rows.length });
      add(
        fk.child,
        rows.map((r) => r.id),
      );
    }
  }

  // Children whose FK is ON DELETE SET NULL survive (they were real rows pointing at a fixture).
  const nullify: { table: string; column: string; count: number }[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const fk of fks) {
      const parentIds = doomed.get(fk.parent);
      if (!parentIds?.size) continue;
      if (fk.onDelete === 'n' || fk.onDelete === 'd') continue;
      const ids = await keysOf(fk, [...parentIds]);
      const rows = await sql<{ id: string }[]>`
        select id::text from ${sql(fk.child)}
        where ${sql(fk.childCol)}::text = any(${ids})`;
      if (
        add(
          fk.child,
          rows.map((r) => r.id),
        )
      )
        changed = true;
    }
  }
  for (const fk of fks) {
    if (fk.onDelete !== 'n' && fk.onDelete !== 'd') continue;
    const ids = await keysOf(fk, [...(doomed.get(fk.parent) ?? [])]);
    if (!ids.length) continue;
    const keep = [...(doomed.get(fk.child) ?? [])];
    const [nulled] = await sql<{ count: number }[]>`
      select count(*)::int as count from ${sql(fk.child)}
      where ${sql(fk.childCol)}::text = any(${ids}) and not (id::text = any(${keep}))`;
    const count = nulled?.count ?? 0;
    if (count) nullify.push({ table: fk.child, column: fk.childCol, count });
  }
  const allIds = [...doomed.values()].flatMap((s) => [...s]);
  const [linkRow] = await sql<{ links: number }[]>`
    select count(*)::int as links from document_link where entity_id::text = any(${allIds})`;

  const summary = [...doomed.entries()]
    .filter(([, s]) => s.size)
    .map(([table, s]) => ({ table, rows: s.size }))
    .sort((a, b) => b.rows - a.rows);
  console.table(summary);
  if (orphans.length) {
    console.log('Of these, rows already pointing at a missing parent:');
    console.table(orphans);
  }
  if (nullify.length) {
    console.log('Real rows that only lose a reference (ON DELETE SET NULL):');
    console.table(nullify);
  }
  console.log(`document_link rows pointing at purged entities: ${linkRow?.links ?? 0}`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete.');
  } else {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`select set_config('app.actor', 'system:purge-e2e', true)`;
      await tx`delete from document_link where entity_id::text = any(${allIds})`;
      for (const fk of fks) {
        if (fk.onDelete !== 'n' && fk.onDelete !== 'd') continue;
        const ids = await keysOf(fk, [...(doomed.get(fk.parent) ?? [])]);
        if (!ids.length) continue;
        await tx`update ${tx(fk.child)} set ${tx(fk.childCol)} = null
                 where ${tx(fk.childCol)}::text = any(${ids})`;
      }
      for (const [table, ids] of doomed) {
        if (ids.size) await tx`delete from ${tx(table)} where id::text = any(${[...ids]})`;
      }

      const all = await tx<
        { child: string; def: string; cols: string[]; pcols: string[]; parent: string }[]
      >`
        select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent,
               array(select attname from pg_attribute where attrelid = c.conrelid and attnum = any(c.conkey) order by array_position(c.conkey, attnum))::text[] as cols,
               array(select attname from pg_attribute where attrelid = c.confrelid and attnum = any(c.confkey) order by array_position(c.confkey, attnum))::text[] as pcols,
               c.conname as def
        from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace`;
      const left: string[] = [];
      for (const fk of all) {
        const notNull = fk.cols.map((c) => `ch.${c} is not null`).join(' and ');
        const join = fk.cols.map((c, i) => `p.${fk.pcols[i]} = ch.${c}`).join(' and ');
        const [orphanRow] = await tx.unsafe<{ n: number }[]>(
          `select count(*)::int as n from ${fk.child} ch where ${notNull}
           and not exists (select 1 from ${fk.parent} p where ${join})`,
        );
        if (orphanRow?.n) left.push(`${fk.def}: ${orphanRow.n}`);
      }
      if (left.length) {
        throw new Error(`Orphans after purge, rolled back:\n${left.join('\n')}`);
      }
    });
    console.log('\nPurged; foreign keys verified.');
  }
} finally {
  await sql.end();
}
