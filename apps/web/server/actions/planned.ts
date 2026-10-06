'use server';

import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { localizeForUser } from '../i18n';
import { requireUserContext } from '../request-context';
import type { ServiceContext } from '../services/context';
import type { ServiceResult } from '../services/define-service';
import {
  deletePaymentCharge,
  deletePlannedExpense,
  deletePlannedPart,
  savePaymentCharge,
  savePlannedExpense,
  savePlannedPart,
} from '../services/planned';
import {
  markPlannedPaid,
  resetPlannedAmount,
  setPlannedAmount,
  skipPlannedPayment,
  unlinkPlannedPayment,
  unskipPlannedPayment,
} from '../services/planned/payments';
import type { ActionResult } from './to-action-result';

export type PlannedFormState = ActionResult<{ id: string }> | null;

const decimalField = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\s/g, '').replace(',', '.') : v;

const DECIMAL_KEYS = ['amount', 'ratePercent', 'feeFixed', 'feePercent', 'feeAmount'];

function formInput(formData: FormData) {
  const input: Record<string, unknown> = formDataToObject(formData);
  for (const key of DECIMAL_KEYS) if (key in input) input[key] = decimalField(input[key]);
  return input;
}

async function finish(
  result: ServiceResult<{ id: string }>,
  extraPath?: string,
): Promise<PlannedFormState> {
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/ledger/planned');
  revalidatePath('/dashboard');
  if (extraPath) revalidatePath(extraPath);
  return { ok: true, data: { id: result.value.id } };
}

async function run(
  service: { run: (ctx: ServiceContext, input: unknown) => Promise<ServiceResult<{ id: string }>> },
  formData: FormData,
  extraPath?: string,
) {
  const ctx = await requireUserContext();
  return finish(await service.run(ctx, formInput(formData)), extraPath);
}

export async function savePlannedExpenseAction(_prev: PlannedFormState, formData: FormData) {
  return run(savePlannedExpense, formData);
}

export async function deletePlannedExpenseAction(_prev: PlannedFormState, formData: FormData) {
  return run(deletePlannedExpense, formData);
}

export async function savePlannedPartAction(_prev: PlannedFormState, formData: FormData) {
  return run(savePlannedPart, formData);
}

export async function deletePlannedPartAction(_prev: PlannedFormState, formData: FormData) {
  return run(deletePlannedPart, formData);
}

/** A charge on a planned expense or on a person's payouts; the person page shows the latter. */
export async function savePaymentChargeAction(_prev: PlannedFormState, formData: FormData) {
  const personId = formData.get('personId');
  const personPath = typeof personId === 'string' && personId ? `/people/${personId}` : undefined;
  return run(savePaymentCharge, formData, personPath);
}

export async function deletePaymentChargeAction(_prev: PlannedFormState, formData: FormData) {
  const personId = formData.get('personId');
  const personPath = typeof personId === 'string' && personId ? `/people/${personId}` : undefined;
  return run(deletePaymentCharge, formData, personPath);
}

export async function payPlannedAction(_prev: PlannedFormState, formData: FormData) {
  const ctx = await requireUserContext();
  const input = formInput(formData);
  const transactionId = input.transactionId;
  const result = await markPlannedPaid.run(ctx, {
    ...input,
    transactionIds:
      typeof transactionId === 'string' && transactionId ? [transactionId] : undefined,
  });
  revalidatePath('/ledger');
  return finish(result);
}

export async function setPlannedAmountAction(_prev: PlannedFormState, formData: FormData) {
  return run(setPlannedAmount, formData);
}

export async function resetPlannedAmountAction(_prev: PlannedFormState, formData: FormData) {
  return run(resetPlannedAmount, formData);
}

export async function skipPlannedAction(_prev: PlannedFormState, formData: FormData) {
  return run(skipPlannedPayment, formData);
}

export async function unskipPlannedAction(_prev: PlannedFormState, formData: FormData) {
  return run(unskipPlannedPayment, formData);
}

export async function unlinkPlannedAction(_prev: PlannedFormState, formData: FormData) {
  return run(unlinkPlannedPayment, formData);
}
