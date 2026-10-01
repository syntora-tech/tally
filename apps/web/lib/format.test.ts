import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../messages/en.json';
import uk from '../messages/uk.json';
import { formatterFor } from './format';

function formatter(locale: 'en' | 'uk') {
  const messages = locale === 'en' ? en : uk;
  return formatterFor(
    locale,
    createTranslator({ locale, messages, namespace: 'months' }) as never,
    createTranslator({ locale, messages, namespace: 'rules' }) as never,
  );
}

const nb = ' ';

describe('formatterFor (A-058)', () => {
  it('groups thousands by locale and keeps DD.MM.YYYY dates', () => {
    expect(formatter('en').amount('93174.6', 'UAH')).toBe(`93,174.60${nb}UAH`);
    expect(formatter('uk').amount('93174.6', 'UAH')).toBe(`93${nb}174.60${nb}UAH`);
    expect(formatter('en').date('2026-10-01')).toBe('01.10.2026');
    expect(formatter('en').month('2026-07-01')).toBe('July 2026');
    expect(formatter('uk').month('2026-07-01')).toBe('Липень 2026');
  });

  it.each([
    ['payment', { type: 'day_of_month', day: 20 }, 'by day 20 of the month', 'до 20 числа'],
    [
      'payment',
      { type: 'net_days', days: 15 },
      '15 days after the invoice',
      'через 15 дн. після інвойсу',
    ],
    [
      'invoice',
      { type: 'first_working_day_after_period' },
      'first working day after the period',
      'перший робочий день після періоду',
    ],
    [
      'act',
      { type: 'nth_working_day_after_period', n: 3 },
      'working day 3 after the period',
      '3-й робочий день після періоду',
    ],
    ['act', { type: 'manual' }, 'manually', 'вручну'],
    ['payment', {}, 'not set', 'не задано'],
  ] as const)('rule %s %j', (kind, rule, enText, ukText) => {
    expect(formatter('en').rule(kind, rule)).toBe(enText);
    expect(formatter('uk').rule(kind, rule)).toBe(ukText);
  });
});

/** Every key must exist in both languages (typed keys come from en.json). */
describe('messages', () => {
  const keys = (tree: object, prefix = ''): string[] =>
    Object.entries(tree).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  it('en and uk have the same keys', () => {
    expect(keys(uk).sort()).toEqual(keys(en).sort());
  });
});
