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
      ...param(paymentDueType === 'day_of_month' ? 'day' : 'days', paymentDueValue),
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
