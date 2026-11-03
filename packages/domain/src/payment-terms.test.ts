import { describe, expect, it } from 'vitest';
import { integerToWordsUaGenitive, paymentTermsText } from './payment-terms';

describe('integerToWordsUaGenitive', () => {
  it.each([
    [1, 'одного'],
    [2, 'двох'],
    [10, 'десяти'],
    [15, "п'ятнадцяти"],
    [20, 'двадцяти'],
    [21, 'двадцяти одного'],
    [30, 'тридцяти'],
    [45, "сорока п'яти"],
    [90, "дев'яноста"],
    [120, 'ста двадцяти'],
    [365, "трьохсот шістдесяти п'яти"],
  ])('%i → %s', (n, words) => {
    expect(integerToWordsUaGenitive(n)).toBe(words);
  });

  it('rejects counts outside 1–999', () => {
    expect(() => integerToWordsUaGenitive(0)).toThrow();
    expect(() => integerToWordsUaGenitive(1000)).toThrow();
  });
});

describe('paymentTermsText', () => {
  it('reproduces the current Boosty clause for net 20 days', () => {
    expect(paymentTermsText({ type: 'net_days', days: 20 })).toEqual({
      en: 'The Customer shall pay all undisputed invoices within twenty (20) days from the date of their receipt',
      ua: 'Замовник здійснює оплату всіх неоспорюваних інвойсів протягом двадцяти (20) днів з моменту їх отримання',
    });
  });

  it('says business days for working-day terms', () => {
    expect(paymentTermsText({ type: 'net_working_days', days: 15 })).toEqual({
      en: 'The Customer shall pay all undisputed invoices within fifteen (15) business days from the date of their receipt',
      ua: "Замовник здійснює оплату всіх неоспорюваних інвойсів протягом п'ятнадцяти (15) робочих днів з моменту їх отримання",
    });
  });

  it('agrees the noun with the last numeral', () => {
    expect(paymentTermsText({ type: 'net_days', days: 1 }).en).toContain('one (1) day from');
    expect(paymentTermsText({ type: 'net_days', days: 21 }).ua).toContain(
      'двадцяти одного (21) дня',
    );
    expect(paymentTermsText({ type: 'net_working_days', days: 11 }).ua).toContain(
      'одинадцяти (11) робочих днів',
    );
  });

  it('names the day for a day-of-month rule', () => {
    const text = paymentTermsText({ type: 'day_of_month', day: 22 });
    expect(text.en).toContain('no later than the 22nd day of the month of their receipt');
    expect(text.ua).toContain('не пізніше 22-го числа місяця їх отримання');
  });
});
