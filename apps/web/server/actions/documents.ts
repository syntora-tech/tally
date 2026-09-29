'use server';

import { revalidatePath } from 'next/cache';
import { requireUserContext } from '../request-context';
import { uploadCv } from '../services/documents/live';
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
