'use server';

import { localizeForUser } from '../i18n';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { createPerson, updatePerson } from '../services/people';
import type { ActionResult } from './to-action-result';

export type PersonFormState = ActionResult<{ id: string }> | null;

export async function savePerson(
  _prev: PersonFormState,
  formData: FormData,
): Promise<PersonFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = input.id ? await updatePerson.run(ctx, input) : await createPerson.run(ctx, input);
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  redirect(`/people/${result.value.id}`);
}
