import { describe, expect, it } from 'vitest';
import { capitalizeFirst, moneyToWordsEn, moneyToWordsUa, uaForm } from './words';

describe('moneyToWordsEn (format of the legacy invoices)', () => {
  it.each([
    ['0', 'Zero U.S. dollars 00 cents'],
    ['1', 'One U.S. dollar 00 cents'],
    ['2', 'Two U.S. dollars 00 cents'],
    ['5', 'Five U.S. dollars 00 cents'],
    ['11', 'Eleven U.S. dollars 00 cents'],
    ['21', 'Twenty-one U.S. dollars 00 cents'],
    ['1000', 'One thousand U.S. dollars 00 cents'],
    ['1100', 'One thousand one hundred U.S. dollars 00 cents'],
    ['8272', 'Eight thousand two hundred seventy-two U.S. dollars 00 cents'],
    ['225', 'Two hundred twenty-five U.S. dollars 00 cents'],
    ['39.38', 'Thirty-nine U.S. dollars 38 cents'],
    ['1000000', 'One million U.S. dollars 00 cents'],
    ['14373', 'Fourteen thousand three hundred seventy-three U.S. dollars 00 cents'],
  ])('%s → %s', (amount, words) => {
    expect(moneyToWordsEn(amount, 'USD')).toBe(words);
  });

  it('rounds to cents half-up first', () => {
    expect(moneyToWordsEn('0.005', 'USD')).toBe('Zero U.S. dollars 01 cent');
  });
});

describe('moneyToWordsUa (spec 7.2)', () => {
  it('spec example: 93 174.60 UAH', () => {
    expect(moneyToWordsUa('93174.60', 'UAH')).toBe(
      "дев'яносто три тисячі сто сімдесят чотири гривні 60 копійок",
    );
  });

  it.each([
    ['0', 'нуль гривень 00 копійок'],
    ['1', 'одна гривня 00 копійок'],
    ['2', 'дві гривні 00 копійок'],
    ['5', "п'ять гривень 00 копійок"],
    ['11', 'одинадцять гривень 00 копійок'],
    ['21', 'двадцять одна гривня 00 копійок'],
    ['1000', 'одна тисяча гривень 00 копійок'],
    ['1100', 'одна тисяча сто гривень 00 копійок'],
    ['2000', 'дві тисячі гривень 00 копійок'],
    ['1000000', 'один мільйон гривень 00 копійок'],
    ['12.01', 'дванадцять гривень 01 копійка'],
    ['89849.6', "вісімдесят дев'ять тисяч вісімсот сорок дев'ять гривень 60 копійок"],
  ])('%s UAH → %s', (amount, words) => {
    expect(moneyToWordsUa(amount, 'UAH')).toBe(words);
  });

  it.each([
    ['1', 'один долар США 00 центів'],
    ['2', 'два долари США 00 центів'],
    ['5', "п'ять доларів США 00 центів"],
    ['21', 'двадцять один долар США 00 центів'],
    ['1100', 'одна тисяча сто доларів США 00 центів'],
    ['8272', 'вісім тисяч двісті сімдесят два долари США 00 центів'],
    ['39.38', "тридцять дев'ять доларів США 38 центів"],
  ])('%s USD → %s', (amount, words) => {
    expect(moneyToWordsUa(amount, 'USD')).toBe(words);
  });

  it('uses 5+ forms for 11–14', () => {
    expect(uaForm(111, ['a', 'b', 'c'])).toBe('c');
    expect(uaForm(114, ['a', 'b', 'c'])).toBe('c');
    expect(uaForm(121, ['a', 'b', 'c'])).toBe('a');
    expect(uaForm(1_000_014, ['a', 'b', 'c'])).toBe('c');
  });

  it('capitalizes for invoice headers', () => {
    expect(capitalizeFirst(moneyToWordsUa('1100', 'USD'))).toBe(
      'Одна тисяча сто доларів США 00 центів',
    );
  });
});
