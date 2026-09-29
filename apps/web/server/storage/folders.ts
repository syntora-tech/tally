import type { DocumentType } from '@tally/db/schema';
import { slugify } from '@tally/domain';

/** The entity a document is filed under: its first link, resolved to a folder owner (7.3, 6.9). */
export type FolderAnchor =
  | { kind: 'person'; name: string }
  | { kind: 'client'; name: string }
  | { kind: 'payee'; name: string }
  | { kind: 'trip'; name: string; year: string }
  | { kind: 'none' };

const CONTRACT_LIKE: readonly DocumentType[] = ['contract', 'sow', 'annex', 'nda'];

/** Folder layout from spec 7.3; year-scoped folders use the document date year. */
export function folderPathFor(type: DocumentType, anchor: FolderAnchor, year: string): string {
  switch (anchor.kind) {
    case 'person':
      return `people/${slugify(anchor.name)}/${type === 'cv' ? 'cv' : 'docs'}`;
    case 'client':
      return type === 'invoice'
        ? `clients/${slugify(anchor.name)}/invoices/${year}`
        : `clients/${slugify(anchor.name)}/contracts`;
    case 'payee':
      return type === 'act'
        ? `payees/${slugify(anchor.name)}/acts/${year}`
        : `payees/${slugify(anchor.name)}/${CONTRACT_LIKE.includes(type) ? 'contracts' : 'docs'}`;
    case 'trip':
      return `trips/${anchor.year}/${slugify(anchor.name)}`;
    case 'none':
      return type === 'statement' ? `ledger/statements/${year}` : 'documents';
  }
}

/** Keeps the original name readable but safe for any file system. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[/\\?%*:|"<>]|\p{Cc}/gu, '_')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'file';
}
