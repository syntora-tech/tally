'use server';

import { redirect } from 'next/navigation';
import { contractFormToInput } from '@/lib/contract-rules';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { createClient, createContract, updateClient, updateContract } from '../services/clients';
import type { ActionResult } from './to-action-result';

export type FormState = ActionResult<{ id: string }> | null;

export async function saveClient(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = input.id ? await updateClient.run(ctx, input) : await createClient.run(ctx, input);
  if (result.isErr()) return { ok: false, error: result.error };
  redirect(`/clients/${result.value.id}`);
}

export async function saveContract(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireUserContext();
  const input = contractFormToInput(formDataToObject(formData));
  const result = input.id
    ? await updateContract.run(ctx, input)
    : await createContract.run(ctx, input);
  if (result.isErr()) return { ok: false, error: result.error };
  redirect(`/clients/contracts/${result.value.id}`);
}
