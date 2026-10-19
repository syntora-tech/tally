'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { localizeForUser } from '../i18n';
import { requireUserContext } from '../request-context';
import {
  commitImport,
  discardImport,
  prepareBankImport,
  prepareCryptoImport,
  suggestImportWithAi,
} from '../services/ledger/import';
import type { ActionResult } from './to-action-result';

export type ImportFormState = ActionResult<unknown> | null;

const importIdOf = (formData: FormData) => {
  const id = formData.get('importId');
  return typeof id === 'string' ? id : '';
};

export async function prepareBankImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ctx = await requireUserContext();
  const result = await prepareBankImport.run(ctx, {
    files: formData.getAll('files'),
    accountId: formData.get('accountId') ?? '',
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/ledger/import');
  redirect(`/ledger/import/${result.value.id}`);
}

export async function prepareCryptoImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ctx = await requireUserContext();
  const result = await prepareCryptoImport.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/ledger/import');
  const { id, aiError } = result.value;
  // The page shows the error by its message key; the draft itself is kept.
  redirect(`/ledger/import/${id}${aiError ? `?aiError=${encodeURIComponent(aiError)}` : ''}`);
}

export async function suggestImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ctx = await requireUserContext();
  const result = await suggestImportWithAi.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/ledger/import/${importIdOf(formData)}`);
  return { ok: true, data: result.value };
}

export async function commitImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ctx = await requireUserContext();
  const result = await commitImport.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/ledger');
  revalidatePath(`/ledger/import/${importIdOf(formData)}`);
  return { ok: true, data: result.value };
}

export async function discardImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const ctx = await requireUserContext();
  const result = await discardImport.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/ledger/import');
  redirect('/ledger/import');
}
