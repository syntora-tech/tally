/**
 * Machine-readable `code` for adapters (UI, MCP `isError`). `message` and `fieldErrors` hold message
 * keys of the `errors` namespace (see `msg`), localized by the adapter: UI language for actions,
 * English for MCP (A-058). Text that is not a known key is shown as is.
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

/** A message key with values, e.g. `msg('ledger.duplicateRef', { ref })` → `ledger.duplicateRef|{"ref":"…"}`. */
export const msg = (key: string, values?: Record<string, string | number>): string =>
  values ? `${key}|${JSON.stringify(values)}` : key;

export const serviceError = (
  code: ServiceErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): ServiceError => (fieldErrors ? { code, message, fieldErrors } : { code, message });

type PgError = {
  code: string;
  message?: string;
  hint?: string;
  detail?: string;
  constraint_name?: string;
};

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
        pg.hint ? msg('db.termsClosedFrom', { date: formatHint(pg.hint) }) : 'db.termsClosed',
      );
    case 'TL001':
    case 'TL002':
      return serviceError('conflict', 'db.immutable');
    case 'TL003':
      return serviceError('validation_error', 'db.snapshotRequired');
    case 'TL004':
      return serviceError('validation_error', msg('db.nonWorkingDay', { date: pg.detail ?? '' }));
    case 'TL005':
      return serviceError('conflict', 'db.invoiceChanged');
    case 'TL006':
      return serviceError('validation_error', 'db.revisionReason');
    case 'TL040':
      return serviceError(
        'validation_error',
        msg('db.postingCurrency', { detail: pg.detail ?? '' }),
      );
    case 'TL041':
      return serviceError('validation_error', 'db.transactionShape');
    case 'TL050':
      return serviceError('validation_error', 'db.noMainPosting');
    case 'TL051':
      return serviceError(
        'validation_error',
        msg('db.allocationCurrency', { detail: pg.detail ?? '' }),
      );
    case 'TL052':
      return serviceError('conflict', 'db.allocationTarget');
    case 'TL053':
      return serviceError(
        'validation_error',
        msg(pg.message?.includes('reimbursement') ? 'db.overReimbursement' : 'db.overInvoice', {
          detail: pg.detail ?? '',
        }),
      );
    case 'TL054':
      return serviceError(
        'validation_error',
        msg('db.overTransaction', { detail: pg.detail ?? '' }),
      );
    case 'TL055':
      return serviceError('conflict', 'db.paidDerived');
    case 'TL032':
      return serviceError('conflict', 'db.periodHasPayouts');
    case 'TL056':
      return serviceError('validation_error', 'payroll.rateFirst');
    case 'TL060':
      return serviceError('validation_error', 'db.actContract');
    case 'TL061':
      return serviceError('not_found', msg('db.linkTargetMissing', { detail: pg.detail ?? '' }));
    case 'TL062':
      return serviceError('validation_error', 'db.annexContract');
    case 'TL063':
      return serviceError('validation_error', 'db.packagePart');
    case 'TL064':
      return serviceError('conflict', 'db.plannedPaid');
    case 'TL020':
      return serviceError('validation_error', 'db.sequenceDown');
    case 'TL021':
      return serviceError('not_found', 'db.noSequence');
    case 'TL022':
      return serviceError('validation_error', 'db.sequenceYear');
    case 'TL030':
      return serviceError('closed_period', 'db.periodClosed');
    case 'TL031':
      return serviceError('validation_error', 'db.reopenReason');
    case '23505':
      return pg.constraint_name?.endsWith('_version_key')
        ? serviceError('conflict', 'db.versionExists')
        : serviceError('conflict', 'db.duplicate');
    case '23503':
      return serviceError('conflict', 'db.referenced');
    case '23P01':
      return serviceError('conflict', 'db.actPeriodsOverlap');
    case '23514':
    case '23502':
    case '22P02':
    case '22007':
    case '22008':
      return serviceError('validation_error', 'db.invalid');
    case '42501':
      return serviceError('forbidden', 'general.forbidden');
    default:
      return null;
  }
}

function formatHint(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return y && m && d ? `${d}.${m}.${y}` : isoDate;
}

export type Translate = (key: string, values?: Record<string, string | number>) => string | null;

const MESSAGE_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

/** Message key (with optional `|{values}`) → text; anything that is not a known key stays as is. */
export function localizeMessage(text: string, translate: Translate): string {
  const sep = text.indexOf('|');
  const key = sep < 0 ? text : text.slice(0, sep);
  if (!MESSAGE_KEY.test(key)) return text;
  let values: Record<string, string | number> | undefined;
  if (sep >= 0) {
    try {
      values = JSON.parse(text.slice(sep + 1)) as Record<string, string | number>;
    } catch {
      return text;
    }
  }
  return translate(key, values) ?? text;
}

export function localizeError(error: ServiceError, translate: Translate): ServiceError {
  const message = localizeMessage(error.message, translate);
  if (!error.fieldErrors) return { ...error, message };
  const fieldErrors = Object.fromEntries(
    Object.entries(error.fieldErrors).map(([field, messages]) => [
      field,
      messages.map((m) => localizeMessage(m, translate)),
    ]),
  );
  return { ...error, message, fieldErrors };
}
