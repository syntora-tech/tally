'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { deleteCalendarException, saveCalendarException, saveSequence } from '../services/settings';
import type { ServiceContext } from '../services/context';
import { createMcpClient, revokeMcpClient } from '../services/mcp';
import type { ServiceResult } from '../services/define-service';
import type { ActionResult } from './to-action-result';

export type SettingsFormState = ActionResult<unknown> | null;

async function run<T>(
  service: { run: (ctx: ServiceContext, input: unknown) => Promise<ServiceResult<T>> },
  formData: FormData,
): Promise<SettingsFormState> {
  const ctx = await requireUserContext();
  const result = await service.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/settings');
  return { ok: true, data: result.value };
}

export async function saveCalendarExceptionAction(_prev: SettingsFormState, formData: FormData) {
  return run(saveCalendarException, formData);
}

export async function deleteCalendarExceptionAction(_prev: SettingsFormState, formData: FormData) {
  return run(deleteCalendarException, formData);
}

export async function saveSequenceAction(_prev: SettingsFormState, formData: FormData) {
  return run(saveSequence, formData);
}

export async function createMcpClientAction(_prev: SettingsFormState, formData: FormData) {
  return run(createMcpClient, formData);
}

export async function revokeMcpClientAction(_prev: SettingsFormState, formData: FormData) {
  return run(revokeMcpClient, formData);
}
