'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { localizeForUser } from '../i18n';
import { requireUserContext } from '../request-context';
import { deleteTripExpense, saveTrip } from '../services/trips';
import { addTripExpense } from '../services/trips/live';
import {
  createReimbursement,
  payReimbursement,
  payReimbursementsFromTransaction,
} from '../services/trips/reimbursements';
import type { ActionResult } from './to-action-result';

export type TripFormState = ActionResult<{ id: string }> | null;

const decimal = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\s/g, '').replace(',', '.') : v;

export async function saveTripAction(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const ctx = await requireUserContext();
  const result = await saveTrip.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/trips');
  redirect(`/trips/${result.value.id}`);
}

export async function addTripExpenseAction(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await addTripExpense.run(ctx, {
    ...input,
    amount: decimal(input.amount),
    fxRate: decimal(input.fxRate),
    accountAmount: decimal(input.accountAmount),
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/trips/${typeof input.tripId === 'string' ? input.tripId : ''}`);
  revalidatePath('/ledger');
  return { ok: true, data: result.value };
}

export async function deleteTripExpenseAction(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const ctx = await requireUserContext();
  const result = await deleteTripExpense.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/trips/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function createReimbursementAction(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await createReimbursement.run(ctx, { ...input, amount: decimal(input.amount) });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/trips/${result.value.tripId}`);
  revalidatePath('/acts');
  return { ok: true, data: result.value };
}

export async function payReimbursementAction(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await payReimbursement.run(ctx, { ...input, amount: decimal(input.amount) });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/trips/${result.value.tripId}`);
  revalidatePath('/ledger');
  return { ok: true, data: result.value };
}

/** Several reimbursements from one Ledger expense (A-108); `items` is JSON from the link dialog. */
export async function payReimbursementsAction(
  _prev: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const ctx = await requireUserContext();
  const raw = formData.get('items');
  let items: unknown;
  try {
    items = typeof raw === 'string' ? JSON.parse(raw) : [];
  } catch {
    items = [];
  }
  const result = await payReimbursementsFromTransaction.run(ctx, {
    transactionId: formData.get('transactionId'),
    items: Array.isArray(items)
      ? items.map((i: { reimbursementId?: unknown; amount?: unknown }) => ({
          reimbursementId: i.reimbursementId,
          amount: decimal(i.amount),
        }))
      : [],
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  for (const id of result.value.tripIds) revalidatePath(`/trips/${id}`);
  revalidatePath('/ledger');
  return { ok: true, data: { id: result.value.id } };
}
