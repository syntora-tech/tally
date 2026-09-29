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

type PgError = { code: string; hint?: string; detail?: string; constraint_name?: string };

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
    case 'TL001':
    case 'TL002':
      return serviceError(
        'conflict',
        'Випущений документ не можна змінити — лише анулювати й перевипустити',
      );
    case 'TL003':
      return serviceError('validation_error', 'Для випуску потрібен знімок документа');
    case 'TL004':
      return serviceError(
        'validation_error',
        `Дата ${pg.detail ?? ''} — неробочий день. Оберіть робочий день або (власник) вкажіть причину`,
      );
    case 'TL005':
      return serviceError('conflict', 'Інвойс щойно змінили — оновіть сторінку й спробуйте ще раз');
    case 'TL006':
      return serviceError('validation_error', 'Вкажіть причину зміни випущеного інвойсу');
    case 'TL020':
      return serviceError('validation_error', 'Лічильник номерів не можна зменшити');
    case 'TL021':
      return serviceError('not_found', 'Для договору не налаштовано послідовність номерів');
    case 'TL022':
      return serviceError('validation_error', 'Дата документа раніша за рік послідовності номерів');
    case 'TL030':
      return serviceError('closed_period', 'Період закрито — години змінювати не можна');
    case 'TL031':
      return serviceError('validation_error', 'Вкажіть причину відкриття періоду');
    case '23505':
      return pg.constraint_name?.endsWith('_version_key')
        ? serviceError('conflict', 'Версія умов з цієї дати вже існує')
        : serviceError('conflict', 'Такий запис уже існує');
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
