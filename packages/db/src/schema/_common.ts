import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  numeric,
  pgPolicy,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
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
/** Mirrors `CRYPTO_NETWORKS` in @tally/domain (a unit test in apps/web keeps them equal). */
export const CRYPTO_NETWORK_CODES = [
  'ETH',
  'BSC',
  'POLYGON',
  'ARBITRUM',
  'BASE',
  'OPTIMISM',
  'AVALANCHE',
  'TRON',
  'SOLANA',
  'BTC',
  'TON',
] as const;

export function networkCheck(name: string, column: AnyPgColumn) {
  const list = sql.join(
    CRYPTO_NETWORK_CODES.map((n) => sql.raw(`'${n}'`)),
    sql`, `,
  );
  return check(name, sql`${column} in (${list})`);
}

export function currencyCheck(name: string, column: AnyPgColumn) {
  return check(name, sql`${column} ~ '^[A-Z]{3,4}$'`);
}

/**
 * Bank transfer fee as a tariff "fixed + %" (A-082). `feeCurrency` is the currency the bank charges
 * in (e.g. UAH for a USD SWIFT transfer); null means the payment's own currency.
 */
export const transferFeeColumns = () => ({
  feeFixed: numeric({ precision: 20, scale: 8 }),
  feePercent: numeric({ precision: 9, scale: 4 }),
  feeCurrency: text(),
});

export function transferFeeChecks(
  table: string,
  t: { feeFixed: AnyPgColumn; feePercent: AnyPgColumn; feeCurrency: AnyPgColumn },
) {
  return [
    check(
      `${table}_fee_check`,
      sql`coalesce(${t.feeFixed}, 0) >= 0 and coalesce(${t.feePercent}, 0) between 0 and 100`,
    ),
    currencyCheck(`${table}_fee_currency_check`, t.feeCurrency),
  ];
}
