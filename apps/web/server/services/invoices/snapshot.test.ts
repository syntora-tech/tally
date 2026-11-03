import { parseLocalDate } from '@tally/domain';
import { describe, expect, it } from 'vitest';
import { buildInvoiceSnapshot, withTemplateDefaults, type SnapshotInput } from './snapshot';

const d = (s: string) => parseLocalDate(s)._unsafeUnwrap();
const nb = ' ';

describe('buildInvoiceSnapshot (spec 7.2 placeholders)', () => {
  const input: SnapshotInput = {
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
    annexes: [{ kind: 'annex', number: '3' }],
    paymentDue: { type: 'net_working_days', days: 15 },
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
  };
  const snap = buildInvoiceSnapshot(input);

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

  it('words the payment clause from the contract rule', () => {
    expect(snap.payment).toEqual({
      terms_en:
        'The Customer shall pay all undisputed invoices within fifteen (15) business days from the date of their receipt',
      terms_ua:
        "Замовник здійснює оплату всіх неоспорюваних інвойсів протягом п'ятнадцяти (15) робочих днів з моменту їх отримання",
    });
  });

  it('refers to the SOWs and annexes of the billed people', () => {
    expect(snap.contract).toMatchObject({
      annexes_en: ' and Annex 3 of this Agreement',
      annexes_ua: ' та Додатку 3 до цієї угоди',
      annexes_short_en: ' (Annex 3)',
      annexes_short_ua: ' (Додаток 3)',
    });
    const two = buildInvoiceSnapshot({
      ...input,
      annexes: [
        { kind: 'sow', number: '1' },
        { kind: 'sow', number: '3' },
      ],
    });
    expect(two.contract.annexes_en).toBe(' and SOW #1, SOW #3 of this Agreement');
    expect(two.contract.annexes_ua).toBe(' та Додатків SOW №1, SOW №3 до цієї угоди');
    const none = buildInvoiceSnapshot({ ...input, annexes: [] });
    expect(none.contract.annexes_en).toBe('');
    expect(none.contract.annexes_short_ua).toBe('');
  });

  it('gives snapshots of version 1 the text their template had hardcoded', () => {
    const { payment: _p, ...v1 } = { ...snap, version: 1 };
    const filled = withTemplateDefaults(v1 as typeof snap);
    expect(filled.payment.terms_en).toContain('within twenty (20) days');
    expect(filled.contract.annexes_en).toBe(' and Exhibit A of this Agreement');
    expect(filled.contract.annexes_ua).toBe(' та Додатку А до цієї угоди');
    expect(withTemplateDefaults(snap)).toBe(snap);
  });
});
