'use server';

import { localizeForUser } from '../i18n';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { createPayee, setDefaultPayee, updatePayee } from '../services/payees';
import type { ActionResult } from './to-action-result';

export type PayeeFormState = ActionResult<{ id: string }> | null;

export async function savePayee(
  _prev: PayeeFormState,
  formData: FormData,
): Promise<PayeeFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = input.id ? await updatePayee.run(ctx, input) : await createPayee.run(ctx, input);
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  redirect(`/people/payees/${result.value.id}`);
}

export async function saveDefaultPayee(
  _prev: PayeeFormState,
  formData: FormData,
): Promise<PayeeFormState> {
  const ctx = await requireUserContext();
  const result = await setDefaultPayee.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/people/${result.value.id}`);
  return { ok: true, data: result.value };
}
