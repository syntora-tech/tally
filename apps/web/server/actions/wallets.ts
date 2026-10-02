'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { addWallet, updateWallet } from '../services/wallets';
import { toActionResult, type ActionResult } from './to-action-result';

export type WalletFormState = ActionResult<{ id: string }> | null;

function revalidateOwners() {
  revalidatePath('/people/[id]', 'page');
  revalidatePath('/clients/[id]', 'page');
}

export async function addWalletAction(
  _prev: WalletFormState,
  formData: FormData,
): Promise<WalletFormState> {
  const ctx = await requireUserContext();
  const result = await addWallet.run(ctx, formDataToObject(formData));
  if (result.isOk()) revalidateOwners();
  return toActionResult(result);
}

export async function updateWalletAction(
  _prev: WalletFormState,
  formData: FormData,
): Promise<WalletFormState> {
  const ctx = await requireUserContext();
  const result = await updateWallet.run(ctx, formDataToObject(formData));
  if (result.isOk()) revalidateOwners();
  return toActionResult(result);
}
