/**
 * Machine-readable `code` for adapters (UI, MCP `isError`), user-facing `message` in Ukrainian.
 */
export type ServiceError = {
  code: ServiceErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ServiceErrorCode =
  | 'validation_error'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error';

export const serviceError = (
  code: ServiceErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ServiceError => (fieldErrors ? { code, message, fieldErrors } : { code, message });
