import { localizeForUser } from '../i18n';
import type { ServiceResult } from '../services/define-service';
import type { ServiceError } from '../services/errors';

/** Serializable shape returned by Server Actions to client components. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

/** Errors leave in the user's language (A-058). */
export async function toActionResult<T>(result: ServiceResult<T>): Promise<ActionResult<T>> {
  return result.isOk()
    ? { ok: true, data: result.value }
    : { ok: false, error: await localizeForUser(result.error) };
}
