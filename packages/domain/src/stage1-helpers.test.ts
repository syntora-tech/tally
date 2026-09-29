import { describe, expect, it } from 'vitest';
import { benchStatus, benchStatusForLoad } from './bench';
import { toCsv } from './csv';
import { parseLocalDate, type LocalDate } from './local-date';
import { numberKey } from './number-key';
import { slugify, transliterateUa } from './slug';
import { effectiveVersion } from './terms';
import { weekdayHoursInMonth } from './work-hours';

const d = (s: string): LocalDate => parseLocalDate(s)._unsafeUnwrap();

describe('effectiveVersion', () => {
  const versions = [
    { validFrom: d('2026-01-01'), rate: '40' },
    { validFrom: d('2026-05-01'), rate: '45' },
    { validFrom: d('2026-09-01'), rate: '47' },
  ];

  it('picks the latest version starting on or before the period', () => {
    expect(effectiveVersion(versions, d('2026-07-01'))?.rate).toBe('45');
    expect(effectiveVersion(versions, d('2026-05-01'))?.rate).toBe('45');
    expect(effectiveVersion(versions, d('2026-09-01'))?.rate).toBe('47');
  });

  it('returns null before the first version and handles unsorted input', () => {
    expect(effectiveVersion(versions, d('2025-12-01'))).toBeNull();
    expect(effectiveVersion([...versions].reverse(), d('2026-12-01'))?.rate).toBe('47');
  });
});

describe('weekdayHoursInMonth', () => {
  it.each([
    ['2026-07-01', 184], // spec 6.4: July 2026 = 184
    ['2026-09-15', 176],
    ['2026-02-01', 160],
  ])('%s → %i', (date, hours) => {
    expect(weekdayHoursInMonth(d(date))).toBe(hours);
  });
});

describe('transliterateUa (KMU 2010 official examples)', () => {
  it.each([
    ['Згорани', 'zghorany'],
    ['Розгон', 'rozghon'],
    ['Єнакієве', 'yenakiieve'],
    ['Гайдамаки', 'haidamaky'],
    ["Короп'є", 'koropie'],
    ['Їжакевич', 'yizhakevych'],
    ['Кадиївка', 'kadyivka'],
    ['Йосипівка', 'yosypivka'],
    ['Стрий', 'stryi'],
    ['Олексій', 'oleksii'],
    ['Юрій', 'yurii'],
    ['Корюківка', 'koriukivka'],
    ['Яготин', 'yahotyn'],
    ['Костянтин', 'kostiantyn'],
    ["Знам'янка", 'znamianka'],
    ['Феодосія', 'feodosiia'],
    ['Щербухи', 'shcherbukhy'],
    ['Гоща', 'hoshcha'],
    ['Ґалаґан', 'galagan'],
  ])('%s → %s', (ua, latin) => {
    expect(transliterateUa(ua)).toBe(latin);
  });
});

describe('slugify', () => {
  it.each([
    ['ЩУРКО ВІТАЛІЯ', 'shchurko-vitaliia'],
    ['Езерович Д. М.', 'ezerovych-d-m'],
    ['  Pavlo Adamenko  ', 'pavlo-adamenko'],
    ['ТОВ «СІНТОРА»', 'tov-sintora'],
    ['Boosty Labs / SOW #3', 'boosty-labs-sow-3'],
    ['Bits&Pretzels Munich', 'bits-pretzels-munich'],
  ])('%j → %s', (input, slug) => {
    expect(slugify(input)).toBe(slug);
  });
});

describe('numberKey (spec 5.6, 9.1)', () => {
  it('normalizes spacing, dashes and Latin A', () => {
    const key = numberKey('1003 - А4');
    expect(numberKey('1003  -А4')).toBe(key);
    expect(numberKey('1003-A4')).toBe(key);
    expect(numberKey('1003 - a4')).toBe(key);
    expect(key).toBe('1003А4');
  });

  it('keeps other characters', () => {
    expect(numberKey('MF281025/10')).toBe('MF281025/10');
    expect(numberKey('24/26')).toBe('24/26');
  });
});

describe('benchStatus (spec 6.2)', () => {
  const on = d('2026-09-29');
  const a = (fte: string, extra: Partial<Parameters<typeof benchStatus>[0][number]> = {}) => ({
    fte,
    isInternal: false,
    startsOn: d('2026-01-01'),
    endsOn: null,
    ...extra,
  });

  it('is free without active client assignments', () => {
    expect(benchStatus([], on).status).toBe('free');
    expect(benchStatus([a('1', { isInternal: true })], on).status).toBe('free');
    expect(benchStatus([a('1', { endsOn: d('2026-08-31') })], on).status).toBe('free');
    expect(benchStatus([a('1', { startsOn: d('2026-10-01') })], on).status).toBe('free');
  });

  it('is partial below 1 FTE and busy from 1 FTE', () => {
    expect(benchStatus([a('0.5')], on)).toMatchObject({ status: 'partial' });
    expect(benchStatus([a('0.5'), a('0.5')], on).status).toBe('busy');
    expect(benchStatus([a('0.5'), a('0.5')], on).load.toString()).toBe('1');
  });

  it('counts the end date as active', () => {
    expect(benchStatus([a('1', { endsOn: on })], on).status).toBe('busy');
  });
});

describe('toCsv', () => {
  it('escapes quotes, commas and newlines and prepends a BOM', () => {
    const csv = toCsv(
      [
        { header: 'Імʼя', value: (r: { name: string; stack: string[] }) => r.name },
        { header: 'Stack', value: (r) => r.stack.join(', ') },
      ],
      [{ name: 'Anton "A"', stack: ['Solidity', 'TS'] }],
    );
    expect(csv).toBe('\uFEFFІмʼя,Stack\r\n"Anton ""A""","Solidity, TS"\r\n');
  });
});

describe('benchStatusForLoad', () => {
  it.each([
    ['0', 'free'],
    ['0.25', 'partial'],
    ['1.00', 'busy'],
    ['1.5', 'busy'],
  ] as const)('%s → %s', (load, status) => {
    expect(benchStatusForLoad(load)).toBe(status);
  });
});
