import { parseDecimal, parseLocalDate, type LocalDate } from '@tally/domain';
import { z } from 'zod';

// Shared Zod building blocks for forms, services and (later) MCP tools. Money and dates stay strings.

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

/** Trimmed text; empty input becomes null. */
export const optionalText = z
  .preprocess(emptyToNull, z.string().trim().max(10_000).nullable().optional())
  .transform((v) => v ?? null);

export const requiredText = (message = 'Обов’язкове поле') =>
  z.string({ error: message }).trim().min(1, message).max(1_000);

/** Decimal as a string (never a JS number), e.g. "5500" or "47.5". */
export const decimalString = z
  .string()
  .trim()
  .refine((v) => parseDecimal(v).isOk(), 'Введіть число, наприклад 5500.00');

export const nonNegativeDecimal = decimalString.refine(
  (v) => !v.startsWith('-'),
  'Значення не може бути від’ємним',
);

export const optionalDecimal = z
  .preprocess(emptyToNull, nonNegativeDecimal.nullable().optional())
  .transform((v) => v ?? null);

export const localDateString = z
  .string()
  .trim()
  .refine((v) => parseLocalDate(v).isOk(), 'Невірна дата')
  .transform((v) => v as LocalDate);

export const optionalLocalDate = z
  .preprocess(emptyToNull, localDateString.nullable().optional())
  .transform((v) => v ?? null);

/** First day of a month, as required for term versions (assumptions A-018). */
export const monthStart = localDateString.refine(
  (v) => v.endsWith('-01'),
  'Дата має бути першим числом місяця',
);

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,4}$/, 'Код валюти: USD, EUR, UAH, USDT…');

/** Tags from a comma-separated string or repeated form fields; trimmed, de-duplicated. */
export const tagList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const raw = Array.isArray(v) ? v : (v ?? '').split(',');
    return [...new Set(raw.map((t) => t.trim()).filter((t) => t.length > 0))];
  });

export const httpUrl = z
  .url({ protocol: /^https?$/, error: 'Посилання має починатися з http(s)://' })
  .max(2_000);

export const optionalHttpUrl = z
  .preprocess(emptyToNull, httpUrl.nullable().optional())
  .transform((v) => v ?? null);

export const checkbox = z
  .union([z.literal('on'), z.literal('true'), z.literal('false'), z.boolean()])
  .optional()
  .transform((v) => v === true || v === 'on' || v === 'true');
