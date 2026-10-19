'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { localizeForUser } from '../i18n';
import { requireUserContext } from '../request-context';
import { deleteAiKey, saveAiKey } from '../services/ai';
import type { ActionResult } from './to-action-result';

export type AiKeyFormState = ActionResult<unknown> | null;

export async function saveAiKeyAction(
  _prev: AiKeyFormState,
  formData: FormData,
): Promise<AiKeyFormState> {
  const ctx = await requireUserContext();
  const result = await saveAiKey.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/settings');
  revalidatePath('/ledger/import');
  return { ok: true, data: result.value };
}

export async function deleteAiKeyAction(
  _prev: AiKeyFormState,
  _formData: FormData,
): Promise<AiKeyFormState> {
  const ctx = await requireUserContext();
  const result = await deleteAiKey.run(ctx, {});
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/settings');
  revalidatePath('/ledger/import');
  return { ok: true, data: result.value };
}
