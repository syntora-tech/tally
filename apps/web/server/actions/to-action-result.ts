import type { ServiceResult } from '../services/define-service';
import type { ServiceError } from '../services/errors';

/** Serializable shape returned by Server Actions to client components. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ServiceError };

export function toActionResult<T>(result: ServiceResult<T>): ActionResult<T> {
  return result.match(
    (data) => ({ ok: true as const, data }),
    (error) => ({ ok: false as const, error }),
  );
}
