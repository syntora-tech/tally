import {
  capitalizeFirst,
  formatAmount,
  formatUaDate,
  moneyToWordsEn,
  moneyToWordsUa,
  toDecimal,
  type LocalDate,
} from '@tally/domain';

export type ContractorInvoiceSnapshotInput = {
  number: string;
  invoiceDate: LocalDate;
  periodFrom: LocalDate | null;
  periodTo: LocalDate | null;
  hours: string | null;
  amount: string;
  currency: string;
  descriptionEn: string;
  descriptionUa: string;
  company: { nameEn: string; nameUa: string; legalCode: string | null };
  contract: { number: string; signedOn: LocalDate | null };
  annex: { number: string } | null;
  payee: {
    legalNameEn: string | null;
    legalNameUa: string | null;
    taxId: string | null;
    addressEn: string | null;
    bankDetailsEn: string | null;
  };
};

/** A bare number reads "Annex 1" / "Додаток 1"; anything else is printed as entered. */
const annexLabels = (number: string) =>
  /^\d+$/.test(number)
    ? { en: `Annex ${number}`, ua: `Додаток ${number}` }
    : { en: number, ua: number };

/** The payee part of the snapshot — the only part a re-render may refresh (A-094). */
export function payeeSnapshot(p: ContractorInvoiceSnapshotInput['payee']) {
  return {
    name_en: p.legalNameEn ?? p.legalNameUa ?? '',
    tax_id: p.taxId ?? '',
    address_en: p.addressEn ?? '',
    bank_en: p.bankDetailsEn ?? '',
  };
}

/** Frozen data of a contractor invoice (`invoice_contractor` placeholders); PDFs render only from this. */
export function buildContractorInvoiceSnapshot(i: ContractorInvoiceSnapshotInput) {
  const date = formatUaDate(i.invoiceDate);
  const signed = i.contract.signedOn ? formatUaDate(i.contract.signedOn) : '';
  const annex = i.annex ? annexLabels(i.annex.number) : null;
  const from = i.periodFrom ? formatUaDate(i.periodFrom) : '';
  const to = i.periodTo ? formatUaDate(i.periodTo) : '';
  const amount = formatAmount(i.amount, undefined, { decimal: 'comma', grouping: 'space' });
  return {
    version: 1,
    doc: { number: i.number, date },
    contract: {
      number: i.contract.number,
      date: signed,
      ref_en: `No. ${i.contract.number}${signed ? ` dated ${signed}` : ''}${annex ? ` (${annex.en})` : ''}`,
      ref_ua: `№${i.contract.number}${signed ? ` від ${signed}` : ''}${annex ? ` (${annex.ua})` : ''}`,
    },
    company: {
      name_en: i.company.nameEn,
      name_ua: i.company.nameUa,
      legal_code: i.company.legalCode ?? '',
    },
    payee: payeeSnapshot(i.payee),
    subject: { en: i.descriptionEn, ua: i.descriptionUa },
    period: { from, to },
    lines: [
      {
        n: '1',
        description_en: i.descriptionEn,
        description_ua: i.descriptionUa,
        qty: i.hours === null ? '' : toDecimal(i.hours).toString(),
        amount,
      },
    ],
    total: {
      amount,
      currency: i.currency,
      words_en: moneyToWordsEn(i.amount, i.currency),
      words_ua: capitalizeFirst(moneyToWordsUa(i.amount, i.currency)),
    },
  };
}

export type ContractorInvoiceSnapshot = ReturnType<typeof buildContractorInvoiceSnapshot>;
