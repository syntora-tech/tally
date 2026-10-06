import {
  SCALE,
  formatAmount,
  formatUaDate,
  type DecimalInput,
  type FormatAmountOptions,
  type LocalDate,
} from '@tally/domain';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/locales';

type MonthTranslator = (key: `${number}`) => string;
type RuleTranslator = (key: string, values?: Record<string, string>) => string;

/**
 * Money, dates and months in the UI language: `1,234.56` in English, `1 234.56` in Ukrainian.
 * Amounts keep their stored precision (rates, hours, crypto) and are never cut below 2 places.
 */
export function formatterFor(locale: Locale, months: MonthTranslator, rules: RuleTranslator) {
  return {
    amount: (value: DecimalInput, currency?: string, options: FormatAmountOptions = {}) =>
      formatAmount(value, currency, {
        grouping: locale === 'en' ? 'comma' : 'space',
        maxDp: SCALE.amount,
        ...options,
      }),
    date: (date: string) => formatUaDate(date as LocalDate),
    /** "2026-07-01" → "July 2026". */
    month: (isoDate: string) => {
      const [year, month] = isoDate.split('-');
      return `${months(String(Number(month)) as `${number}`)} ${year ?? ''}`;
    },
    /** Stored contract date/payment rule (spec 5.5) as text. */
    rule: (kind: 'payment' | 'invoice' | 'act', raw: unknown) => {
      const rule = (raw ?? {}) as { type?: string; day?: unknown; days?: unknown; n?: unknown };
      const v = (x: unknown) => (typeof x === 'number' || typeof x === 'string' ? String(x) : '?');
      switch (rule.type) {
        case 'day_of_month':
          return rules('day_of_month', { day: v(rule.day) });
        case 'net_days':
          return rules('net_days', { days: v(rule.days) });
        case 'net_working_days':
          return rules('net_working_days', { days: v(rule.days) });
        case 'nth_working_day_after_period':
          return rules('nth_working_day_after_period', { n: v(rule.n) });
        case 'first_working_day_after_period':
        case 'last_working_day_of_period':
        case 'manual':
          return rules(rule.type);
        default:
          return kind === 'payment' ? rules('paymentUnset') : '—';
      }
    },
  };
}

export type Formatter = ReturnType<typeof formatterFor>;

/** Drops trailing zeros of numeric(20,8) values for editing: "60.00000000" → "60". */
export function editableDecimal(v: string | null | undefined): string {
  if (!v) return '';
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
}

/** For client and non-async server components; async ones use `getFormat()`. */
export function useFormat(): Formatter {
  return formatterFor(
    useLocale(),
    useTranslations('months') as MonthTranslator,
    useTranslations('rules') as RuleTranslator,
  );
}
