import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { appUser } from './app-user';
import { baseColumns, isOwner } from './_common';

export const MCP_PROFILES = ['read_only', 'assistant', 'custom'] as const;
export type McpProfile = (typeof MCP_PROFILES)[number];

/**
 * An MCP client and its access profile (spec 13.5), checked on every call. Until the OAuth
 * server of stage 7 a client is a personal access token: only its SHA-256 is stored (A-053).
 */
export const mcpClientPolicy = pgTable(
  'mcp_client_policy',
  {
    ...baseColumns,
    clientId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    clientName: text().notNull(),
    profile: text().notNull().default('read_only'),
    /** Tool names for the `custom` profile. */
    allowedTools: text().array(),
    tokenHash: text(),
    /** Last characters of the token, to tell tokens apart in the UI. */
    tokenHint: text(),
    isActive: boolean().notNull().default(true),
    lastUsedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique('mcp_client_policy_client_id_key').on(t.clientId),
    unique('mcp_client_policy_token_hash_key').on(t.tokenHash),
    check(
      'mcp_client_policy_profile_check',
      sql`${t.profile} in ('read_only', 'assistant', 'custom')`,
    ),
    check('mcp_client_policy_name_check', sql`length(trim(${t.clientName})) > 0`),
    pgPolicy('mcp_client_policy_select_owner', {
      for: 'select',
      to: authenticatedRole,
      using: isOwner,
    }),
    pgPolicy('mcp_client_policy_insert_owner', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: isOwner,
    }),
    pgPolicy('mcp_client_policy_update_owner', {
      for: 'update',
      to: authenticatedRole,
      using: isOwner,
      withCheck: isOwner,
    }),
  ],
);

/** First response per (client, key) for write tools, kept 7 days (13.4 rule 2). System-only. */
export const mcpIdempotency = pgTable(
  'mcp_idempotency',
  {
    clientId: text().notNull(),
    key: text().notNull(),
    tool: text().notNull(),
    response: jsonb().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.key] })],
).enableRLS();

/** One row per tool call; arguments are stored only as a hash (13.5). */
export const mcpCallLog = pgTable(
  'mcp_call_log',
  {
    id: bigserial({ mode: 'bigint' }).primaryKey(),
    clientId: text().notNull(),
    userId: uuid(),
    tool: text().notNull(),
    argsHash: text(),
    outcome: text().notNull(),
    durationMs: integer().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mcp_call_log_client_at_idx').on(t.clientId, t.at),
    pgPolicy('mcp_call_log_select_owner', { for: 'select', to: authenticatedRole, using: isOwner }),
  ],
);

export type McpClientPolicy = typeof mcpClientPolicy.$inferSelect;
