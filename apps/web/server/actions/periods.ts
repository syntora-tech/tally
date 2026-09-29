'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseCsv } from '@/lib/csv-parse';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import {
  closePeriod,
  importHours,
  openPeriod,
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
  if (result.isErr()) return { ok: false, error: result.error };
  redirect(`/periods/${result.value.id}`);
}

export async function updatePeriodAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await updatePeriod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath(`/periods/${result.value.id}`);
  return { ok: true, data: result.value };
}

/** The hours table posts `hours.<assignmentId>` fields; blank cells are left untouched. */
export async function saveHoursAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const periodId = field(formData.get('periodId'));
  const rows = [...formData.entries()]
    .map(([k, v]) => [k, field(v)] as const)
    .filter(([k, v]) => k.startsWith('hours.') && v.trim() !== '')
    .map(([k, v]) => ({ assignmentId: k.slice('hours.'.length), hours: v.replace(',', '.') }));
  if (rows.length === 0)
    return { ok: false, error: serviceError('validation_error', 'Немає годин для збереження') };
  const result = await importHours.run(ctx, { periodId, rows });
  if (result.isErr()) return { ok: false, error: result.error };
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
    return { ok: false, error: serviceError('validation_error', 'Оберіть CSV-файл') };
  }
  const rows = parseCsv(await file.text())
    .filter((r) => (r.hours ?? '') !== '')
    .map((r) => ({
      assignmentId: r.assignment_id ?? '',
      hours: (r.hours ?? '').replace(',', '.'),
    }));
  const result = await importHours.run(ctx, { periodId, rows });
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath(`/periods/${periodId}`);
  return { ok: true, data: { id: periodId } };
}

export async function closePeriodAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await closePeriod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath(`/periods/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function reopenPeriodAction(
  _prev: PeriodFormState,
  formData: FormData,
): Promise<PeriodFormState> {
  const ctx = await requireUserContext();
  const result = await reopenPeriod.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath(`/periods/${result.value.id}`);
  return { ok: true, data: result.value };
}
