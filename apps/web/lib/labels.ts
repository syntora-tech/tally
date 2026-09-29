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

export const CONTRACT_STATUS_LABELS: Record<string, string> = {
  active: 'Діючий',
  ended: 'Завершений',
};

export const CONTRACT_KIND_LABELS: Record<string, string> = {
  client: 'Договір з клієнтом',
  fop: 'Договір з ФОП',
};

export const PAYMENT_DUE_TYPES = [
  { value: 'day_of_month', label: 'До числа місяця' },
  { value: 'net_days', label: 'Через N днів після інвойсу' },
];

export const INVOICE_DATE_TYPES = [
  { value: 'first_working_day_after_period', label: 'Перший робочий день після періоду' },
  { value: 'nth_working_day_after_period', label: 'N-й робочий день після періоду' },
];

export const BILLING_TYPE_LABELS: Record<string, string> = {
  hourly: 'Погодинно',
  fixed_monthly: 'Фіксовано за місяць',
  none: 'Не виставляється',
};

export const PRORATION_LABELS: Record<string, string> = {
  full_month: 'Повна сума незалежно від годин',
  by_hours: 'Пропорційно годинам (ставка / норма × години)',
  trunc_hourly: 'Ціла погодинна ставка (floor(ставка / норма) × години)',
};

export const PAY_TYPE_LABELS: Record<string, string> = {
  fixed: 'Фіксована сума',
  hourly: 'Погодинно від місячної суми',
  included: 'Включено (0)',
};

export const PAYOUT_METHOD_LABELS: Record<string, string> = {
  fiat: 'Фіат',
  crypto: 'Крипто',
};

export const RELEASE_POLICY_LABELS: Record<string, string> = {
  on_payment_or_due: 'Після оплати клієнтом або в дедлайн',
  immediate: 'Одразу',
};

export const ACT_DATE_TYPES = [
  { value: 'last_working_day_of_period', label: 'Останній робочий день періоду' },
  { value: 'nth_working_day_after_period', label: 'N-й робочий день після періоду' },
  { value: 'manual', label: 'Лише вручну' },
];
