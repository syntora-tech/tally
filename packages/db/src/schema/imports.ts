import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { appUser } from './app-user';
import { baseColumns, isAnyRole, rolePolicies } from './_common';

export const USER_SECRET_KINDS = ['anthropic_api_key'] as const;
export type UserSecretKind = (typeof USER_SECRET_KINDS)[number];

const ownRow = sql`user_id = (select auth.uid()) and ${isAnyRole}`;

/**
 * A personal secret of one user, e.g. their own Anthropic API key (A-120). Encrypted by the app
 * (AES-256-GCM bound to the user id); only the owner of the row can read or change it — not even
 * another owner. No audit trigger: the log would copy the ciphertext to rows others can read.
 */
export const userSecret = pgTable(
  'user_secret',
  {
    ...baseColumns,
    userId: uuid()
      .notNull()
      .default(sql`auth.uid()`)
      .references(() => appUser.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    ciphertext: text().notNull(),
    /** Last characters of the plain value, to recognise it in the UI. */
    hint: text().notNull(),
    verifiedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('user_secret_user_kind_key').on(t.userId, t.kind),
    check('user_secret_kind_check', sql`${t.kind} in ('anthropic_api_key')`),
    check('user_secret_ciphertext_check', sql`${t.ciphertext} like 'v1:%'`),
    pgPolicy('user_secret_select_own', { for: 'select', to: authenticatedRole, using: ownRow }),
    pgPolicy('user_secret_insert_own', { for: 'insert', to: authenticatedRole, withCheck: ownRow }),
    pgPolicy('user_secret_update_own', {
      for: 'update',
      to: authenticatedRole,
      using: ownRow,
      withCheck: ownRow,
    }),
    pgPolicy('user_secret_delete_own', { for: 'delete', to: authenticatedRole, using: ownRow }),
  ],
);

export const LEDGER_IMPORT_KINDS = ['bank', 'crypto'] as const;
export type LedgerImportKind = (typeof LEDGER_IMPORT_KINDS)[number];
export const LEDGER_IMPORT_STATUSES = ['draft', 'committed', 'discarded'] as const;
export type LedgerImportStatus = (typeof LEDGER_IMPORT_STATUSES)[number];

/**
 * A statement upload or a crypto fetch waiting for review (A-121, A-122). Rows hold the facts
 * read from the bank file or the chain — amounts, dates, references — plus suggestions; the
 * person's choices arrive with the commit, which books them through the Ledger batch service.
 * A committed or discarded import is frozen (TL068).
 */
export const ledgerImport = pgTable(
  'ledger_import',
  {
    ...baseColumns,
    kind: text().notNull(),
    status: text().notNull().default('draft'),
    /** Files or wallets read: name, sha256, account, period. */
    sources: jsonb()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rows: jsonb().notNull(),
    /** Outcome of the commit (created, linked, skipped) and of AI calls (tokens). */
    summary: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
    committedAt: timestamp({ withTimezone: true }),
    committedBy: uuid(),
  },
  (t) => [
    check('ledger_import_kind_check', sql`${t.kind} in ('bank', 'crypto')`),
    check('ledger_import_status_check', sql`${t.status} in ('draft', 'committed', 'discarded')`),
    check(
      'ledger_import_committed_check',
      sql`(${t.status} = 'committed') = (${t.committedAt} is not null)`,
    ),
    check('ledger_import_rows_check', sql`jsonb_typeof(${t.rows}) = 'array'`),
    index('ledger_import_created_at_idx').on(t.createdAt),
    ...rolePolicies('ledger_import', { read: 'finance', write: 'finance' }),
  ],
);

export type LedgerImport = typeof ledgerImport.$inferSelect;
