'use server';

import { localizeForUser } from '../i18n';
import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { saveCompany } from '../services/company';
import type { ActionResult } from './to-action-result';

export type CompanyFormState = ActionResult<{ id: string }> | null;

export async function saveCompanyAction(
  _prev: CompanyFormState,
  formData: FormData,
): Promise<CompanyFormState> {
  const ctx = await requireUserContext();
  const result = await saveCompany.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/settings');
  return { ok: true, data: result.value };
}
