'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject, nestPrefixed } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import {
  createTransaction,
  deleteTransaction,
  saveAccount,
  saveCategory,
} from '../services/ledger';
import type { ActionResult } from './to-action-result';

export type LedgerFormState = ActionResult<{ id: string }> | null;

export async function createTransactionAction(
  _prev: LedgerFormState,
  formData: FormData,
): Promise<LedgerFormState> {
  const ctx = await requireUserContext();
  const input = nestPrefixed(formDataToObject(formData), ['from', 'to', 'fee']);
  const result = await createTransaction.run(ctx, input);
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/ledger');
  redirect('/ledger');
}

export async function deleteTransactionAction(
  _prev: LedgerFormState,
  formData: FormData,
): Promise<LedgerFormState> {
  const ctx = await requireUserContext();
  const result = await deleteTransaction.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/ledger');
  return { ok: true, data: result.value };
}

export async function saveAccountAction(
  _prev: LedgerFormState,
  formData: FormData,
): Promise<LedgerFormState> {
  const ctx = await requireUserContext();
  const result = await saveAccount.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/ledger');
  revalidatePath('/ledger/accounts');
  return { ok: true, data: result.value };
}

export async function saveCategoryAction(
  _prev: LedgerFormState,
  formData: FormData,
): Promise<LedgerFormState> {
  const ctx = await requireUserContext();
  const result = await saveCategory.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/ledger/categories');
  return { ok: true, data: result.value };
}
