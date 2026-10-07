'use server';

import { localizeForUser } from '../i18n';
import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { overridePayable } from '../services/payroll/payability';
import { mergeActs, splitActByActivity } from '../services/acts';
import { payItem, setPayoutRate } from '../services/payroll';
import type { ActionResult } from './to-action-result';

export type PayrollFormState = ActionResult<{ id: string }> | null;

const decimalField = (v: unknown) => (typeof v === 'string' ? v.replace(',', '.').trim() : v);

export async function payItemAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await payItem.run(ctx, {
    ...input,
    amount: decimalField(input.amount),
    rate: decimalField(input.rate),
    feeAmount: decimalField(input.feeAmount),
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  revalidatePath('/ledger');
  return { ok: true, data: result.value };
}

/** Approve or correct the payout rate of a fiat item; its draft act follows (A-076). */
export async function setPayoutRateAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await setPayoutRate.run(ctx, { ...input, rate: decimalField(input.rate) });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  revalidatePath('/payroll/acts');
  return { ok: true, data: { id: result.value.id } };
}

export async function overridePayableAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const result = await overridePayable.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  return { ok: true, data: { id: result.value.id } };
}

/** Joins two neighbouring draft acts of one payout (A-083). */
export async function mergeActsAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const result = await mergeActs.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  return { ok: true, data: result.value };
}

/** Splits a draft act by the chosen activities (A-085). */
export async function splitActAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const result = await splitActByActivity.run(ctx, {
    actId: formData.get('actId'),
    lineIds: formData.getAll('lineIds'),
    adjustmentIds: formData.getAll('adjustmentIds'),
    periodFrom: formData.get('periodFrom'),
    periodTo: formData.get('periodTo'),
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  return { ok: true, data: result.value };
}
