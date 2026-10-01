import { createTranslator } from 'next-intl';
import en from '../../messages/en.json';
import { localizeError, type ServiceError } from '../services/errors';

const t = createTranslator({ locale: 'en', messages: en, namespace: 'errors' });

/** Agents always get English messages, whatever the owner's UI language (A-058). */
export function localizeForAgent(error: ServiceError): ServiceError {
  return localizeError(error, (key, values) =>
    t.has(key as never) ? t(key as never, values as never) : null,
  );
}
