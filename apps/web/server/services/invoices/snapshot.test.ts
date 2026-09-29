import { parseLocalDate } from '@tally/domain';
import { describe, expect, it } from 'vitest';
import { buildInvoiceSnapshot } from './snapshot';

const d = (s: string) => parseLocalDate(s)._unsafeUnwrap();
const nb = ' ';

describe('buildInvoiceSnapshot (spec 7.2 placeholders)', () => {
  const snap = buildInvoiceSnapshot({
    number: '25/26',
    issueDate: d('2026-10-01'),
    dueDate: d('2026-10-20'),
    revision: 1,
    currency: 'USD',
    total: '8648.00',
    company: {
      nameEn: 'LLC "SYNTORA"',
      nameUa: 'ТОВ «СІНТОРА»',
      legalCode: '46140580',
      addressEn: '17 Polova Street',
      addressUa: 'вул. Польова, 17',
      directorEn: 'Vladyslav Boichenko, Director',
      directorUa: 'директора Бойченко В.С.',
      bankDetailsEn: 'IBAN UA83…',
      bankDetailsUa: null,
      placeEn: 'Odesa',
      placeUa: 'м. Одеса',
    },
    client: { legalName: 'GlobalSoft OÜ', address: 'Tallinn', bankDetails: null },
    contract: { number: '2025-28/10', signedOn: d('2025-10-28') },
    periodMonth: d('2026-09-01'),
    lines: [
      {
        descriptionEn: 'Dev — Andrii',
        descriptionUa: 'Розробка — Андрій',
        quantity: '176.00',
        unitPrice: '47.00000000',
        amount: '8272.00',
      },
    ],
  });

  it('formats dates, period text and totals', () => {
    expect(snap.doc).toMatchObject({
      number: '25/26',
      date: '01.10.2026',
      due_date: '20.10.2026',
      place_ua: 'м. Одеса',
    });
    expect(snap.period.text_ua).toBe('з 01.09.2026 року по 30.09.2026 року');
    expect(snap.contract).toMatchObject({ number: '2025-28/10', date: '28.10.2025' });
    expect(snap.total).toEqual({
      amount: `8${nb}648.00`,
      currency: 'USD',
      words_en: 'Eight thousand six hundred forty-eight U.S. dollars 00 cents',
      words_ua: 'Вісім тисяч шістсот сорок вісім доларів США 00 центів',
    });
  });

  it('numbers lines and never leaves nulls for placeholders', () => {
    expect(snap.lines).toEqual([
      {
        n: '1',
        description_en: 'Dev — Andrii',
        description_ua: 'Розробка — Андрій',
        qty: '176.00',
        price: '47.00',
        amount: `8${nb}272.00`,
      },
    ]);
    expect(JSON.stringify(snap)).not.toContain('null');
  });
});
