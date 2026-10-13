import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { LocalDate } from '@tally/domain';
import { validateTemplate } from '../../render/template';
import { buildContractorInvoiceSnapshot, type ContractorInvoiceSnapshotInput } from './snapshot';

const NNBSP = ' ';

const date = (s: string) => s as LocalDate;

const input: ContractorInvoiceSnapshotInput = {
  number: '16092026',
  invoiceDate: date('2026-09-16'),
  periodFrom: date('2026-08-01'),
  periodTo: date('2026-08-31'),
  hours: '152.00',
  amount: '3000.00',
  currency: 'USD',
  descriptionEn: 'Software Development',
  descriptionUa: 'Розробка програмного забезпечення',
  company: { nameEn: 'LLC "SYNTORA"', nameUa: 'ТОВ "СІНТОРА"', legalCode: '46140580' },
  contract: { number: '1004', signedOn: date('2025-10-28') },
  annex: { number: '1' },
  payee: {
    legalNameEn: 'Andrii Skoropupov (ANDRII SKOROPUPOV)',
    legalNameUa: null,
    taxId: '(Canada) 961-358-652',
    addressEn: '912-1 Grosvenor St, London, ON N6A 1Y2 (Canada)',
    bankDetailsEn: 'Beneficiary: ANDRII SKOROPUPOV\nSWIFT B|C code: CIBCCATT',
  },
};

describe('contractor invoice snapshot', () => {
  it('reads like the contractor’s own invoice No. 16092026', () => {
    const s = buildContractorInvoiceSnapshot(input);
    expect(s.doc).toEqual({ number: '16092026', date: '16.09.2026' });
    expect(s.contract.ref_en).toBe('No. 1004 dated 28.10.2025 (Annex 1)');
    expect(s.contract.ref_ua).toBe('№1004 від 28.10.2025 (Додаток 1)');
    expect(s.payee).toMatchObject({
      name_en: 'Andrii Skoropupov (ANDRII SKOROPUPOV)',
      tax_id: '(Canada) 961-358-652',
    });
    expect(s.lines).toEqual([
      {
        n: '1',
        description_en: 'Software Development',
        description_ua: 'Розробка програмного забезпечення',
        qty: '152',
        amount: `3${NNBSP}000,00`,
      },
    ]);
    expect(s.total.words_ua).toBe('Три тисячі доларів США 00 центів');
    expect(s.total.words_en).toMatch(/^Three thousand U\.?S\.? dollars 00 cents$/);
  });

  it('prints a named annex as entered and leaves out a missing one', () => {
    expect(
      buildContractorInvoiceSnapshot({ ...input, annex: { number: 'SOW #2' } }).contract.ref_en,
    ).toBe('No. 1004 dated 28.10.2025 (SOW #2)');
    expect(buildContractorInvoiceSnapshot({ ...input, annex: null }).contract.ref_ua).toBe(
      '№1004 від 28.10.2025',
    );
  });
});

describe('invoice_contractor template', () => {
  it('uses only placeholders the snapshot fills', () => {
    const html = readFileSync(
      new URL('../../../../../docs/templates/invoice_contractor.html', import.meta.url),
      'utf8',
    );
    const rows = html.split('</tr>');
    const lineRow = rows.find((r) => r.includes('{{line.')) ?? '';
    const global = rows.filter((r) => r !== lineRow).join('</tr>');
    expect(validateTemplate(buildContractorInvoiceSnapshot(input), global, lineRow).isOk()).toBe(
      true,
    );
  });
});
