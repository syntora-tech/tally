import {
  capitalizeFirst,
  endOfMonth,
  formatAmount,
  formatUaDate,
  moneyToWordsEn,
  moneyToWordsUa,
  type LocalDate,
} from '@tally/domain';

export type SnapshotInput = {
  number: string;
  issueDate: LocalDate;
  dueDate: LocalDate;
  revision: number;
  currency: string;
  total: string;
  company: {
    nameEn: string;
    nameUa: string;
    legalCode: string | null;
    addressEn: string | null;
    addressUa: string | null;
    directorEn: string | null;
    directorUa: string | null;
    bankDetailsEn: string | null;
    bankDetailsUa: string | null;
    placeEn: string;
    placeUa: string;
  };
  client: { legalName: string; address: string | null; bankDetails: string | null };
  contract: { number: string; signedOn: LocalDate | null };
  periodMonth: LocalDate | null;
  lines: {
    descriptionEn: string;
    descriptionUa: string;
    quantity: string;
    unitPrice: string;
    amount: string;
  }[];
};

/**
 * Frozen document data (spec 7): PDFs are rendered only from this, never from live rows, so a
 * re-render a year later gives the same document. Keys match the `{{path}}` placeholders of 7.2.
 */
export function buildInvoiceSnapshot(i: SnapshotInput) {
  const date = formatUaDate(i.issueDate);
  const period = i.periodMonth
    ? {
        from: formatUaDate(i.periodMonth),
        to: formatUaDate(endOfMonth(i.periodMonth)),
        text_ua: `з ${formatUaDate(i.periodMonth)} року по ${formatUaDate(endOfMonth(i.periodMonth))} року`,
      }
    : { from: '', to: '', text_ua: '' };
  return {
    version: 1,
    revision: i.revision,
    doc: {
      number: i.number,
      date,
      date_ua: date,
      due_date: formatUaDate(i.dueDate),
      place_en: i.company.placeEn,
      place_ua: i.company.placeUa,
    },
    contract: {
      number: i.contract.number,
      date: i.contract.signedOn ? formatUaDate(i.contract.signedOn) : '',
      title_en: `Contract No ${i.contract.number}`,
    },
    company: {
      name_en: i.company.nameEn,
      name_ua: i.company.nameUa,
      address_en: i.company.addressEn ?? '',
      address_ua: i.company.addressUa ?? '',
      director_en: i.company.directorEn ?? '',
      director_ua: i.company.directorUa ?? '',
      bank_en: i.company.bankDetailsEn ?? '',
      bank_ua: i.company.bankDetailsUa ?? '',
      legal_code: i.company.legalCode ?? '',
    },
    client: {
      name: i.client.legalName,
      address: i.client.address ?? '',
      bank: i.client.bankDetails ?? '',
    },
    period,
    total: {
      amount: formatAmount(i.total),
      currency: i.currency,
      words_en: moneyToWordsEn(i.total, i.currency),
      words_ua: capitalizeFirst(moneyToWordsUa(i.total, i.currency)),
    },
    lines: i.lines.map((l, index) => ({
      n: String(index + 1),
      description_en: l.descriptionEn,
      description_ua: l.descriptionUa,
      qty: formatAmount(l.quantity),
      price: formatAmount(l.unitPrice),
      amount: formatAmount(l.amount),
    })),
  };
}

export type InvoiceSnapshot = ReturnType<typeof buildInvoiceSnapshot>;
