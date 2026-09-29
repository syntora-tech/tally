'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formDataToObject } from '@/lib/form-data';
import { requireUserContext } from '../request-context';
import { createDocument, uploadCv } from '../services/documents/live';
import { linkDocument, unlinkDocument, updateDocument } from '../services/documents/registry';
import type { ActionResult } from './to-action-result';

export type UploadState = ActionResult<{ id: string }> | null;

export async function uploadPersonCv(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const ctx = await requireUserContext();
  const personId = formData.get('personId');
  const result = await uploadCv.run(ctx, { personId, file: formData.get('file') });
  if (result.isErr()) return { ok: false, error: result.error };
  if (typeof personId === 'string') revalidatePath(`/people/${personId}`);
  return { ok: true, data: result.value };
}

/** Links arrive as a JSON array from the chips picker. */
function parseLinks(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export async function createDocumentAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const ctx = await requireUserContext();
  const input = formDataToObject(formData);
  const result = await createDocument.run(ctx, { ...input, links: parseLinks(input.links) });
  if (result.isErr()) return { ok: false, error: result.error };
  redirect(`/documents/${result.value.id}`);
}

export async function updateDocumentAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const ctx = await requireUserContext();
  const result = await updateDocument.run(ctx, formDataToObject(formData));
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath(`/documents/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function linkDocumentAction(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const ctx = await requireUserContext();
  const { target, documentId } = formDataToObject(formData);
  const [entityType, entityId] = typeof target === 'string' ? target.split(':') : [];
  const result = await linkDocument.run(ctx, { documentId, entityType, entityId });
  if (result.isErr()) return { ok: false, error: result.error };
  revalidatePath(`/documents/${result.value.id}`);
  return { ok: true, data: result.value };
}

export async function unlinkDocumentAction(formData: FormData): Promise<void> {
  const ctx = await requireUserContext();
  const result = await unlinkDocument.run(ctx, formDataToObject(formData));
  if (result.isOk()) revalidatePath(`/documents/${result.value.id}`);
}
