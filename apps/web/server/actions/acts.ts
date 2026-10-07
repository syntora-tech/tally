'use server';

import { localizeForUser } from '../i18n';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { runJobsAfterResponse } from '../jobs';
import { requireUserContext } from '../request-context';
import { createAct, issueAct, saveActDraft, setSignedUrl, voidAct } from '../services/acts';
import type { ActionResult } from './to-action-result';

export type ActFormState = ActionResult<{ id: string }> | null;

const decimalField = (v: unknown) => (typeof v === 'string' ? v.replace(',', '.').trim() : v);

function done(id: string): ActFormState {
  revalidatePath(`/acts/${id}`);
  revalidatePath('/acts');
  return { ok: true, data: { id } };
}

export async function createActAction(
  _prev: ActFormState,
  formData: FormData,
): Promise<ActFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await createAct.run(ctx, { ...input, amountUah: decimalField(input.amountUah) });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  redirect(`/acts/${result.value.id}`);
}

export async function saveActDraftAction(
  _prev: ActFormState,
  formData: FormData,
): Promise<ActFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await saveActDraft.run(ctx, {
    ...input,
    amountUah: decimalField(input.amountUah),
  });
  return result.isErr()
    ? { ok: false, error: await localizeForUser(result.error) }
    : done(result.value.id);
}

export async function issueActAction(
  _prev: ActFormState,
  formData: FormData,
): Promise<ActFormState> {
  const ctx = await requireUserContext();
  const result = await issueAct.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  runJobsAfterResponse();
  return done(result.value.id);
}

export async function voidActAction(
  _prev: ActFormState,
  formData: FormData,
): Promise<ActFormState> {
  const ctx = await requireUserContext();
  const result = await voidAct.run(ctx, formDataToObject(formData));
  return result.isErr()
    ? { ok: false, error: await localizeForUser(result.error) }
    : done(result.value.id);
}

export async function setSignedUrlAction(
  _prev: ActFormState,
  formData: FormData,
): Promise<ActFormState> {
  const ctx = await requireUserContext();
  const result = await setSignedUrl.run(ctx, formDataToObject(formData));
  return result.isErr()
    ? { ok: false, error: await localizeForUser(result.error) }
    : done(result.value.id);
}
