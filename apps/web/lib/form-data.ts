/**
 * FormData → plain object for service input. Repeated keys become arrays; File entries are kept.
 * Validation stays in the service's Zod schema.
 */
export function formDataToObject(
  formData: FormData,
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const out: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith('$ACTION')) continue;
    const values = formData.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] ?? '');
  }
  return out;
}

/** Groups `prefix.field` keys into nested objects: `{ 'pay.type': 'fixed' }` → `{ pay: { type } }`. */
export function nestPrefixed(
  flat: Record<string, unknown>,
  prefixes: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nested: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(flat)) {
    const dot = key.indexOf('.');
    const prefix = dot > 0 ? key.slice(0, dot) : '';
    if (prefixes.includes(prefix)) {
      nested[prefix] ??= {};
      nested[prefix][key.slice(dot + 1)] = value;
    } else {
      out[key] = value;
    }
  }
  return { ...out, ...nested };
}
