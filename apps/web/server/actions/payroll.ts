'use server';

import { addDays, parseLocalDate } from '@tally/domain';
import { localizeForUser } from '../i18n';
import { revalidatePath } from 'next/cache';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { overridePayable } from '../services/payroll/payability';
import { mergeActs, splitActByActivity } from '../services/acts';
import { payItem, setPayoutRate } from '../services/payroll';
import { adjustClosedPayout, removePayoutLine } from '../services/payroll/lines';
import { changePayoutMethod } from '../services/payroll/method';
import type { ActionResult } from './to-action-result';

export type PayrollFormState = ActionResult<{ id: string; rate?: string }> | null;

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
  const result = await setPayoutRate.run(ctx, {
    ...input,
    rate: decimalField(input.rate),
    totalUah:
      typeof input.totalUah === 'string'
        ? input.totalUah.replace(/\s/g, '').replace(',', '.')
        : undefined,
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  revalidatePath('/acts');
  // The rate is reported back only when it was derived from a typed UAH sum.
  const derived = typeof input.totalUah === 'string' && input.totalUah.trim() !== '';
  return { ok: true, data: { id: result.value.id, rate: derived ? result.value.rate : undefined } };
}

/** Takes a line out of an unpaid payout of a closed month (A-097). */
export async function removePayoutLineAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const result = await removePayoutLine.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  revalidatePath('/acts');
  return { ok: true, data: { id: result.value.removed.itemId } };
}

/** Owner's adjustment of an unpaid payout of a closed month (A-099). */
export async function adjustClosedPayoutAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await adjustClosedPayout.run(ctx, {
    ...input,
    amount: typeof input.amount === 'string' ? input.amount.replace(',', '.').trim() : input.amount,
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  revalidatePath('/acts');
  return { ok: true, data: { id: result.value.itemId } };
}

/** Moves an unpaid payout to a USD method after the close (A-092). */
export async function changePayoutMethodAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  const result = await changePayoutMethod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  revalidatePath('/acts');
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
  revalidatePath('/periods/[id]', 'page');
  return { ok: true, data: result.value };
}

/** Splits a draft act by the chosen activities (A-085). */
export async function splitActAction(
  _prev: PayrollFormState,
  formData: FormData,
): Promise<PayrollFormState> {
  const ctx = await requireUserContext();
  // The form gives one boundary day and the side of it the new act takes.
  const field = (k: string) => {
    const v = formData.get(k);
    return typeof v === 'string' ? v : '';
  };
  const boundary = parseLocalDate(field('boundary'));
  const first = field('side') !== 'second';
  // The last act may run on past the act's own end (A-098).
  const end = field('actEnd') || field('actTo');
  const range = boundary.isOk()
    ? first
      ? { periodFrom: field('actFrom'), periodTo: boundary.value }
      : { periodFrom: addDays(boundary.value, 1), periodTo: end }
    : { periodFrom: '', periodTo: '' };
  const result = await splitActByActivity.run(ctx, {
    actId: field('actId'),
    lineIds: formData.getAll('lineIds'),
    assignmentIds: formData.getAll('assignmentIds'),
    adjustmentIds: formData.getAll('adjustmentIds'),
    amountUsd: field('amountUsd'),
    ...range,
    periodEnd: end === field('actTo') ? undefined : end,
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath('/payroll');
  revalidatePath('/periods/[id]', 'page');
  return { ok: true, data: result.value };
}
