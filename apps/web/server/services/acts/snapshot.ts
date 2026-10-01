import {
  capitalizeFirst,
  formatAmount,
  formatUaDate,
  moneyToWordsUa,
  type LocalDate,
} from '@tally/domain';

export type ActSnapshotInput = {
  number: string;
  actDate: LocalDate;
  periodFrom: LocalDate | null;
  periodTo: LocalDate | null;
  amountUah: string;
  company: {
    nameUa: string;
    legalCode: string | null;
    addressUa: string | null;
    directorUa: string | null;
    bankDetailsUa: string | null;
    placeUa: string;
  };
  contract: { number: string; signedOn: LocalDate | null };
  payee: {
    legalNameUa: string | null;
    taxId: string | null;
    edrRecord: string | null;
    edrDate: LocalDate | null;
    addressUa: string | null;
    iban: string | null;
    bankName: string | null;
  };
};

/** Frozen data of a FOP act (spec 7.2 `act_fop` placeholders); PDFs render only from this. */
export function buildActSnapshot(i: ActSnapshotInput) {
  const date = formatUaDate(i.actDate);
  const from = i.periodFrom ? formatUaDate(i.periodFrom) : '';
  const to = i.periodTo ? formatUaDate(i.periodTo) : '';
  return {
    version: 1,
    doc: { number: i.number, date, date_ua: date, place_ua: i.company.placeUa },
    contract: {
      number: i.contract.number,
      date: i.contract.signedOn ? formatUaDate(i.contract.signedOn) : '',
    },
    company: {
      name_ua: i.company.nameUa,
      address_ua: i.company.addressUa ?? '',
      director_ua: i.company.directorUa ?? '',
      bank_ua: i.company.bankDetailsUa ?? '',
      legal_code: i.company.legalCode ?? '',
    },
    payee: {
      name_ua: i.payee.legalNameUa ?? '',
      tax_id: i.payee.taxId ?? '',
      edr_record: i.payee.edrRecord ?? '',
      edr_date: i.payee.edrDate ? formatUaDate(i.payee.edrDate) : '',
      address_ua: i.payee.addressUa ?? '',
      iban: i.payee.iban ?? '',
      bank: i.payee.bankName ?? '',
    },
    period: { from, to, text_ua: from && to ? `з ${from} року по ${to} року` : '' },
    total: {
      amount: formatAmount(i.amountUah),
      currency: 'UAH',
      words_ua: capitalizeFirst(moneyToWordsUa(i.amountUah, 'UAH')),
    },
  };
}

export type ActSnapshot = ReturnType<typeof buildActSnapshot>;
