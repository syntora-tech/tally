'use server';

import { localizeForUser } from '../i18n';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject, nestPrefixed } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import {
  addAgencyVersion,
  addBillingVersion,
  addPayVersion,
  createAssignment,
  updateAssignment,
  updateBillingVersion,
  updatePayVersion,
} from '../services/assignments';
import type { ActionResult } from './to-action-result';

export type AssignmentFormState = ActionResult<{ id: string }> | null;

export async function saveAssignment(
  _prev: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await requireUserContext();
  const input = nestPrefixed(formDataToObject(formData), ['billing', 'pay']);
  const result = input.id
    ? await updateAssignment.run(ctx, input)
    : await createAssignment.run(ctx, input);
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  redirect(`/people/assignments/${result.value.id}`);
}

export async function addAgencyVersionAction(
  _prev: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await addAgencyVersion.run(ctx, {
    ...input,
    ratePerHour:
      typeof input.ratePerHour === 'string'
        ? input.ratePerHour.replace(',', '.')
        : input.ratePerHour,
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/people/assignments/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function addTermsVersion(
  _prev: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await requireUserContext();
  const { side, ...input } = formDataToObject(formData);
  const service = side === 'pay' ? addPayVersion : addBillingVersion;
  const result = await service.run(ctx, input);
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/people/assignments/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function updateTermsVersion(
  _prev: AssignmentFormState,
  formData: FormData,
): Promise<AssignmentFormState> {
  const ctx = await requireUserContext();
  const { side, ...input } = formDataToObject(formData);
  const service = side === 'pay' ? updatePayVersion : updateBillingVersion;
  const result = await service.run(ctx, input);
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/people/assignments/${result.value.id}`);
  return { ok: true, data: result.value };
}
