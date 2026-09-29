import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { baseColumns, rolePolicies } from './_common';
import { docStatus } from './enums';

export const DOCUMENT_TYPES = [
  'contract',
  'sow',
  'annex',
  'invoice',
  'act',
  'cv',
  'nda',
  'statement',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const LINK_ENTITY_TYPES = [
  'person',
  'payee',
  'client',
  'contract',
  'assignment',
  'invoice',
  'supplier_act',
  'trip',
  'transaction',
] as const;
export type LinkEntityType = (typeof LINK_ENTITY_TYPES)[number];

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

export const document = pgTable(
  'document',
  {
    ...baseColumns,
    // Source row of the legacy xlsx import (spec 8); makes re-imports idempotent.
    legacyRef: text(),
    type: text().notNull(),
    number: text(),
    // Keep in sync with numberKey() in @tally/domain (spec 5.6).
    numberKey: text().generatedAlwaysAs(
      sql`translate(upper(regexp_replace(number, '[[:space:]-]', '', 'g')), 'A', 'А')`,
    ),
    title: text().notNull(),
    docDate: date({ mode: 'string' }),
    url: text(),
    // Storage key of the active DocumentStorage driver (Drive file id or local key).
    driveFileId: text(),
    fileName: text(),
    mimeType: text(),
    sizeBytes: bigint({ mode: 'number' }),
    status: docStatus().notNull().default('issued'),
    version: integer().notNull().default(1),
    supersedesId: uuid().references((): AnyPgColumn => document.id),
    /** Set on the signed copy that replaces a generated invoice/act (e.g. from Vchasno). */
    signedAt: timestamp({ withTimezone: true }),
    notes: text(),
  },
  (t) => [
    unique('document_legacy_ref_key').on(t.legacyRef),
    check('document_type_check', sql`${t.type} in (${inList(DOCUMENT_TYPES)})`),
    check('document_version_check', sql`${t.version} >= 1`),
    unique('document_supersedes_key').on(t.supersedesId),
    index('document_number_key_idx').on(t.numberKey),
    ...rolePolicies('document', { read: 'all', write: 'finance' }),
  ],
);

/** Polymorphic link: a document may be attached to any number of entities, or none (6.9). */
export const documentLink = pgTable(
  'document_link',
  {
    ...baseColumns,
    documentId: uuid()
      .notNull()
      .references(() => document.id, { onDelete: 'cascade' }),
    entityType: text().notNull(),
    entityId: uuid().notNull(),
  },
  (t) => [
    check(
      'document_link_entity_type_check',
      sql`${t.entityType} in (${inList(LINK_ENTITY_TYPES)})`,
    ),
    unique('document_link_key').on(t.documentId, t.entityType, t.entityId),
    index('document_link_entity_idx').on(t.entityType, t.entityId),
    ...rolePolicies('document_link', { read: 'all', write: 'finance' }),
  ],
);

/** Cache of lazily created Drive folders (7.3); system scope only. */
export const driveFolder = pgTable('drive_folder', {
  path: text().primaryKey(),
  folderId: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type Document = typeof document.$inferSelect;
export type DocumentLink = typeof documentLink.$inferSelect;
