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

export const ALLOCATION_LABELS: Record<string, string> = {
  full_time: 'Повна зайнятість',
  part_time: 'Часткова зайнятість',
};

export const PERSON_STATUS_LABELS: Record<string, string> = {
  active: 'Активний',
  bench: 'На бенчі',
  inactive: 'Неактивний',
};

export const BENCH_LABELS: Record<string, string> = {
  free: 'Вільний',
  partial: 'Частково',
  busy: 'Зайнятий',
};

export const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export const PAYEE_KIND_LABELS: Record<string, string> = {
  fop: 'ФОП',
  crypto: 'Крипто-гаманець',
  other: 'Інше',
};
