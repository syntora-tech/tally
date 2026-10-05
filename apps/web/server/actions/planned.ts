'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { localizeForUser } from '../i18n';
import { requireUserContext } from '../request-context';
import { deletePlannedExpense, savePlannedExpense } from '../services/planned';
import type { ActionResult } from './to-action-result';

export type PlannedFormState = ActionResult<{ id: string }> | null;

const decimalField = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\s/g, '').replace(',', '.') : v;

export async function savePlannedExpenseAction(
  _prev: PlannedFormState,
  formData: FormData,
): Promise<PlannedFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await savePlannedExpense.run(ctx, {
    ...input,
    amount: decimalField(input.amount),
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/ledger/planned');
  revalidatePath('/dashboard');
  return { ok: true, data: result.value };
}

export async function deletePlannedExpenseAction(
  _prev: PlannedFormState,
  formData: FormData,
): Promise<PlannedFormState> {
  const ctx = await requireUserContext();
  const result = await deletePlannedExpense.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/ledger/planned');
  revalidatePath('/dashboard');
  return { ok: true, data: result.value };
}
