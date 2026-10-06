'use server';

import { localizeForUser } from '../i18n';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseCsv } from '@/lib/csv-parse';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import {
  addAdjustment,
  closePeriod,
  importHours,
  openPeriod,
  removeAdjustment,
  reopenPeriod,
  updatePeriod,
} from '../services/periods';
import { serviceError } from '../services/errors';
import type { ActionResult } from './to-action-result';

export type PeriodFormState = ActionResult<{ id: string }> | null;

const field = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export async function openPeriodAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await openPeriod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  redirect(`/periods/${result.value.id}`);
}

export async function updatePeriodAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await updatePeriod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/periods/${result.value.id}`);
  return { ok: true, data: result.value };
}

/**
 * The hours table posts `hours.<assignmentId>` (client) and `payHours.<assignmentId>` (person,
 * blank = the client hours) fields; rows with blank client hours are left untouched.
 */
export async function saveHoursAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const periodId = field(formData.get('periodId'));
  const entries = [...formData.entries()].map(([k, v]) => [k, field(v)] as const);
  const notes = new Map(
    entries.filter(([k]) => k.startsWith('note.')).map(([k, v]) => [k.slice('note.'.length), v]),
  );
  const payHours = new Map(
    entries
      .filter(([k]) => k.startsWith('payHours.'))
      .map(([k, v]) => [k.slice('payHours.'.length), v.trim().replace(',', '.')]),
  );
  const rows = entries
    .filter(([k, v]) => k.startsWith('hours.') && v.trim() !== '')
    .map(([k, v]) => {
      const assignmentId = k.slice('hours.'.length);
      return {
        assignmentId,
        hours: v.replace(',', '.'),
        payHours: payHours.get(assignmentId),
        note: notes.get(assignmentId),
      };
    });
  const withHours = new Set(rows.map((r) => r.assignmentId));
  if ([...payHours].some(([id, v]) => v !== '' && !withHours.has(id))) {
    return {
      ok: false,
      error: await localizeForUser(
        serviceError('validation_error', 'periods.payHoursWithoutHours'),
      ),
    };
  }
  if ([...notes].some(([id, note]) => note.trim() !== '' && !withHours.has(id))) {
    return {
      ok: false,
      error: await localizeForUser(serviceError('validation_error', 'periods.noteWithoutHours')),
    };
  }
  if (rows.length === 0)
    return {
      ok: false,
      error: await localizeForUser(serviceError('validation_error', 'periods.noHours')),
    };
  const result = await importHours.run(ctx, { periodId, rows });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/periods/${periodId}`);
  return { ok: true, data: { id: periodId } };
}

export async function uploadHoursCsvAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const periodId = field(formData.get('periodId'));
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return {
      ok: false,
      error: await localizeForUser(serviceError('validation_error', 'periods.chooseCsv')),
    };
  }
  const rows = parseCsv(await file.text())
    .filter((r) => (r.hours ?? '') !== '')
    .map((r) => ({
      assignmentId: r.assignment_id ?? '',
      hours: (r.hours ?? '').replace(',', '.'),
      payHours: r.pay_hours?.trim().replace(',', '.'),
      note: r.note,
    }));
  const result = await importHours.run(ctx, { periodId, rows });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/periods/${periodId}`);
  return { ok: true, data: { id: periodId } };
}

export async function closePeriodAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await closePeriod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/periods/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function reopenPeriodAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await reopenPeriod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/periods/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function addAdjustmentAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await addAdjustment.run(ctx, {
    ...input,
    amount: typeof input.amount === 'string' ? input.amount.replace(',', '.') : input.amount,
  });
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/periods/${field(formData.get('periodId'))}`);
  return { ok: true, data: result.value };
}

export async function removeAdjustmentAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await removeAdjustment.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: await localizeForUser(result.error) };
  revalidatePath(`/periods/${field(formData.get('periodId'))}`);
  return { ok: true, data: result.value };
}
