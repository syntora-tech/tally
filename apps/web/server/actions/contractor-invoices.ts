'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { localizeForUser } from '../i18n';
import { runJobsAfterResponse } from '../jobs';
import { requireUserContext } from '../request-context';
import {
  deleteContractorInvoiceDraft,
  draftContractorInvoice,
  issueContractorInvoice,
  rerenderContractorInvoice,
  saveContractorInvoiceDraft,
  voidContractorInvoice,
} from '../services/contractor-invoices';
import type { ActionResult } from './to-action-result';

export type ContractorInvoiceFormState = ActionResult<{ id: string }> | null;

function done(id: string): ContractorInvoiceFormState {
  revalidatePath(`/payroll/contractor-invoices/${id}`);
  revalidatePath('/payroll');
  return { ok: true, data: { id } };
}

export async function draftContractorInvoiceAction(
  _prev: ContractorInvoiceFormState,
  formData: FormData,
): Promise<ContractorInvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await draftContractorInvoice.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  redirect(`/payroll/contractor-invoices/${result.value.id}`);
}

export async function saveContractorInvoiceDraftAction(
  _prev: ContractorInvoiceFormState,
  formData: FormData,
): Promise<ContractorInvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await saveContractorInvoiceDraft.run(ctx, formDataToObject(formData));
  return result.isErr()
    ? { ok: false, error: await localizeForUser(result.error) }
    : done(result.value.id);
}

export async function issueContractorInvoiceAction(
  _prev: ContractorInvoiceFormState,
  formData: FormData,
): Promise<ContractorInvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await issueContractorInvoice.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  runJobsAfterResponse();
  return done(result.value.id);
}

export async function voidContractorInvoiceAction(
  _prev: ContractorInvoiceFormState,
  formData: FormData,
): Promise<ContractorInvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await voidContractorInvoice.run(ctx, formDataToObject(formData));
  return result.isErr()
    ? { ok: false, error: await localizeForUser(result.error) }
    : done(result.value.id);
}

export async function deleteContractorInvoiceAction(
  _prev: ContractorInvoiceFormState,
  formData: FormData,
): Promise<ContractorInvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await deleteContractorInvoiceDraft.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  redirect('/payroll');
}

export async function rerenderContractorInvoiceAction(
  _prev: ContractorInvoiceFormState,
  formData: FormData,
): Promise<ContractorInvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await rerenderContractorInvoice.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  runJobsAfterResponse();
  revalidatePath('/documents');
  return done(result.value.id);
}
