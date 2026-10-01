'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { runJobsAfterResponse } from '../jobs';
import { requireUserContext } from '../request-context';
import { allocateToInvoice, removeAllocation } from '../services/allocations';
import { attachSignedInvoice } from '../services/documents/live';
import {
  issueInvoice,
  issuePreview,
  regenerateInvoicePdf,
  reissueInvoice,
  saveInvoice,
  voidInvoice,
} from '../services/invoices';
import { toActionResult, type ActionResult } from './to-action-result';

export type InvoiceFormState = ActionResult<{ id: string }> | null;

const LINE_FIELDS = ['id', 'descriptionEn', 'descriptionUa', 'quantity', 'unitPrice'] as const;

/** The line editor posts `lines.<n>.<field>`; rows with every field blank are dropped. */
function linesFrom(formData: FormData) {
  const rows = new Map<string, Record<string, string>>();
  for (const [key, value] of formData.entries()) {
    const m = /^lines\.(\d+)\.(\w+)$/.exec(key);
    if (!m?.[1] || !m[2] || typeof value !== 'string') continue;
    const row = rows.get(m[1]) ?? {};
    row[m[2]] = m[2] === 'quantity' || m[2] === 'unitPrice' ? value.replace(',', '.') : value;
    rows.set(m[1], row);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, row]) => row)
    .filter((row) => LINE_FIELDS.some((f) => f !== 'id' && (row[f] ?? '').trim() !== ''));
}

function done(id: string): InvoiceFormState {
  revalidatePath(`/invoices/${id}`);
  revalidatePath('/invoices');
  return { ok: true, data: { id } };
}

export async function saveInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const { id, issueDate, dateOverrideReason, reason } = formDataToObject(formData);
  const result = await saveInvoice.run(ctx, {
    id,
    issueDate,
    dateOverrideReason,
    reason,
    lines: linesFrom(formData),
  });
  if (result.isErr()) return { ok: false, error: result.error };
  if (reason) runJobsAfterResponse();
  return done(result.value.id);
}

export async function issuePreviewAction(id: string, issueDate: string) {
  const ctx = await requireUserContext();
  return toActionResult(await issuePreview.run(ctx, { id, issueDate }));
}

export async function issueInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await issueInvoice.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  runJobsAfterResponse();
  return done(result.value.id);
}

export async function voidInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await voidInvoice.run(ctx, formDataToObject(formData));
  return result.isErr() ? { ok: false, error: result.error } : done(result.value.id);
}

export async function reissueInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await reissueInvoice.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/invoices');
  redirect(`/invoices/${result.value.id}`);
}

export async function attachSignedInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await attachSignedInvoice.run(ctx, input);
  return result.isErr()
    ? { ok: false, error: result.error }
    : done(typeof input.invoiceId === 'string' ? input.invoiceId : '');
}

export async function regenerateInvoicePdfAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const result = await regenerateInvoicePdf.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  runJobsAfterResponse();
  return done(result.value.id);
}

export async function allocatePaymentAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await allocateToInvoice.run(ctx, {
    ...input,
    amount: typeof input.amount === 'string' ? input.amount.replace(',', '.') : input.amount,
  });
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/ledger');
  return done(typeof input.invoiceId === 'string' ? input.invoiceId : '');
}

export async function removeAllocationAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await removeAllocation.run(ctx, input);
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath('/ledger');
  return done(typeof input.invoiceId === 'string' ? input.invoiceId : '');
}
