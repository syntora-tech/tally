import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/** Columns every business table carries (spec 4.2). `updated_at` is maintained by `set_updated_at()`. */
export const baseColumns = {
  id: uuid().primaryKey().defaultRandom(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid().default(sql`auth.uid()`),
};

export const isOwner = sql`(select public.current_app_role()) = 'owner'`;
export const isOwnerOrFinance = sql`(select public.current_app_role()) in ('owner', 'finance')`;
