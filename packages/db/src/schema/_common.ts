import { sql, type SQL } from 'drizzle-orm';
import { check, pgPolicy, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** Columns every business table carries (spec 4.2). `updated_at` is maintained by `set_updated_at()`. */
export const baseColumns = {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid().default(sql`auth.uid()`),
};

export const isOwner = sql`(select public.current_app_role()) = 'owner'`;
export const isOwnerOrFinance = sql`(select public.current_app_role()) in ('owner', 'finance')`;
export const isAnyRole = sql`(select public.current_app_role()) is not null`;

export type Access = 'owner' | 'finance' | 'all';

const accessSql: Record<Access, SQL> = {
  owner: isOwner,
  finance: isOwnerOrFinance,
  all: isAnyRole,
};

/**
 * RLS policies for the spec 4.4 matrix: `read` for select, `write` for insert/update/delete.
 * `finance` means owner + finance; `all` means any active app_user.
 */
export function rolePolicies(table: string, access: { read: Access; write: Access }) {
  const read = accessSql[access.read];
  const write = accessSql[access.write];
  return [
    pgPolicy(`${table}_select`, { for: 'select', to: authenticatedRole, using: read }),
    pgPolicy(`${table}_insert`, { for: 'insert', to: authenticatedRole, withCheck: write }),
    pgPolicy(`${table}_update`, {
      for: 'update',
      to: authenticatedRole,
      using: write,
      withCheck: write,
    }),
    pgPolicy(`${table}_delete`, { for: 'delete', to: authenticatedRole, using: write }),
  ];
}

/** ISO 4217 codes plus 4-letter stablecoins (USDT, USDC), spec 4.2 `char(3|4)`. */
export function currencyCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^[A-Z]{3,4}$'`);
}
