type Rule = { type: string; day?: number; days?: number; n?: number };

/**
 * Flat contract form (type selects + numeric fields) → nested rule objects expected by
 * `contracts.create/update`. Pure shape mapping; validation stays in the service schema.
 */
export function contractFormToInput(form: Record<string, unknown>): Record<string, unknown> {
  const {
    paymentDueType,
    paymentDueValue,
    invoiceDateType,
    invoiceDateN,
    actDateType,
    actDateN,
    ...rest
  } = form;
  const param = (key: 'day' | 'days' | 'n', value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? { [key]: value.trim() } : {};

  return {
    ...rest,
    paymentDueRule: {
      type: paymentDueType,
      ...param(paymentDueType === 'net_days' ? 'days' : 'day', paymentDueValue),
    },
    invoiceDateRule: {
      type: invoiceDateType,
      ...(invoiceDateType === 'nth_working_day_after_period' ? param('n', invoiceDateN) : {}),
    },
    actDateRule: {
      type: actDateType,
      ...(actDateType === 'nth_working_day_after_period' ? param('n', actDateN) : {}),
    },
  };
}

/** Human-readable Ukrainian description of a stored rule (spec 5.5). */
export function describeRule(kind: 'payment' | 'invoice' | 'act', raw: unknown): string {
  const rule = (raw ?? {}) as Rule;
  switch (rule.type) {
    case 'day_of_month':
      return `до ${rule.day ?? '?'} числа`;
    case 'net_days':
      return `через ${rule.days ?? '?'} дн. після інвойсу`;
    case 'first_working_day_after_period':
      return 'перший робочий день після періоду';
    case 'last_working_day_of_period':
      return 'останній робочий день періоду';
    case 'nth_working_day_after_period':
      return `${rule.n ?? '?'}-й робочий день після періоду`;
    case 'manual':
      return 'вручну';
    default:
      return kind === 'payment' ? 'не задано' : '—';
  }
}
