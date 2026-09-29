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
  | 'closed_period'
  | 'internal_error';

export const serviceError = (
  code: ServiceErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ServiceError => (fieldErrors ? { code, message, fieldErrors } : { code, message });

type PgError = { code: string; hint?: string; constraint_name?: string };

function findPgError(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (
      typeof current === 'object' &&
      'code' in current &&
      typeof current.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(current.code)
    ) {
      return current as PgError;
    }
    current = typeof current === 'object' && 'cause' in current ? current.cause : null;
  }
  return null;
}

/** Translates Postgres invariant violations (checks, RLS, I10…) into service errors. */
export function mapDbError(error: unknown): ServiceError | null {
  const pg = findPgError(error);
  if (!pg) return null;
  switch (pg.code) {
    case 'TL010':
      return serviceError(
        'closed_period',
        `Не можна змінювати умови заднім числом у закритому періоді. Нова версія може починатися не раніше ${pg.hint ? formatHint(pg.hint) : 'першого відкритого місяця'}.`,
      );
    case '23505':
      return serviceError('conflict', 'Такий запис уже існує');
    case '23503':
      return serviceError('conflict', 'Запис пов’язаний з іншими даними');
    case '23514':
    case '23502':
    case '22P02':
    case '22007':
    case '22008':
      return serviceError('validation_error', 'Дані не пройшли перевірку');
    case '42501':
      return serviceError('forbidden', 'Недостатньо прав для цієї дії');
    default:
      return null;
  }
}

function formatHint(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}.${m}.${y}` : isoDate;
}
