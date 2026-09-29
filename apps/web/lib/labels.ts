import type { DocumentType } from '@tally/db/schema';

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  contract: 'Договір',
  sow: 'SOW',
  annex: 'Додаток',
  invoice: 'Інвойс',
  act: 'Акт',
  cv: 'CV',
  nda: 'NDA',
  statement: 'Виписка',
  other: 'Інше',
};

export const DOC_STATUS_LABELS: Record<string, string> = {
  draft: 'Чернетка',
  issued: 'Діючий',
  void: 'Анульований',
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  INSERT: 'Створено',
  UPDATE: 'Змінено',
  DELETE: 'Видалено',
};
