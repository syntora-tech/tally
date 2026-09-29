import { pgEnum } from 'drizzle-orm/pg-core';

export const appRole = pgEnum('app_role', ['owner', 'finance', 'viewer']);
export type AppRole = (typeof appRole.enumValues)[number];
