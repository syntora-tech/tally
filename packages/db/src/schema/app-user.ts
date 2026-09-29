import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  pgPolicy,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole, authUsers } from 'drizzle-orm/supabase';
import { baseColumns, isOwner } from './_common';
import { appRole } from './enums';

export const appUser = pgTable(
  'app_user',
  {
    ...baseColumns,
    // Same id as auth.users, so no default.
    id: uuid().primaryKey(),
    email: text().notNull(),
    role: appRole().notNull().default('viewer'),
    isActive: boolean().notNull().default(true),
  },
  (t) => [
    foreignKey({
      columns: [t.id],
      foreignColumns: [authUsers.id],
      name: 'app_user_id_fkey',
    }).onDelete('cascade'),
    uniqueIndex('app_user_email_key').using('btree', sql`lower(${t.email})`),
    pgPolicy('app_user_select_self_or_owner', {
      for: 'select',
      to: authenticatedRole,
      using: sql`${t.id} = (select auth.uid()) or ${isOwner}`,
    }),
    pgPolicy('app_user_insert_owner', { for: 'insert', to: authenticatedRole, withCheck: isOwner }),
    pgPolicy('app_user_update_owner', {
      for: 'update',
      to: authenticatedRole,
      using: isOwner,
      withCheck: isOwner,
    }),
    pgPolicy('app_user_delete_owner', { for: 'delete', to: authenticatedRole, using: isOwner }),
  ],
);

export type AppUser = typeof appUser.$inferSelect;
