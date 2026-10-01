'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { overridePayable } from '../services/payroll/payability';
import { payItem } from '../services/payroll';
import type { ActionResult } from './to-action-result';

export type PayrollFormState = ActionResult<{ id: string }> | null;

const decimalField = (v: unknown) => (typeof v === 'string' ? v.replace(',', '.').trim() : v);

export async function payItemAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await payItem.run(ctx, {
    ...input,
    amount: decimalField(input.amount),
    rate: decimalField(input.rate),
  });
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/payroll');
  revalidatePath('/ledger');
  return { ok: true, data: result.value };
}

export async function overridePayableAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const result = await overridePayable.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/payroll');
  return { ok: true, data: { id: result.value.id } };
}
