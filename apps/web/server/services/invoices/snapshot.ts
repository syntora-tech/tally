import {
  capitalizeFirst,
  endOfMonth,
  formatAmount,
  formatUaDate,
  moneyToWordsEn,
  SCALE,
  moneyToWordsUa,
  paymentTermsText,
  roundHalfUp,
  type LocalDate,
  type PaymentDueRule,
} from '@tally/domain';

export type InvoiceAnnex = { kind: string; number: string };

/**
 * " and SOW #3 of this Agreement" / " та Додатку SOW №3 до цієї угоди", empty without annexes; the
 * leading space lets the template put the placeholder right after the contract date.
 */
function annexReference(annexes: readonly InvoiceAnnex[]) {
  if (!annexes.length) return { en: '', ua: '', short_en: '', short_ua: '' };
  const en = annexes.map((a) => (a.kind === 'sow' ? `SOW #${a.number}` : `Annex ${a.number}`));
  // As the documents title themselves: "Statement of Work #3", "Annex 3 to Contract".
  const ua = annexes.map((a) => (a.kind === 'sow' ? `SOW №${a.number}` : a.number));
  const one = annexes.length === 1;
  return {
    en: ` and ${en.join(', ')} of this Agreement`,
    ua: ` та ${one ? 'Додатку' : 'Додатків'} ${ua.join(', ')} до цієї угоди`,
    short_en: ` (${en.join(', ')})`,
    short_ua: ` (${one ? 'Додаток' : 'Додатки'} ${ua.join(', ')})`,
  };
}

const paymentTerms = (rule: PaymentDueRule) => {
  const terms = paymentTermsText(rule);
  return { terms_en: terms.en, terms_ua: terms.ua };
};

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
  /** SOWs/annexes the billed people work under, as referenced in the offer clause. */
  annexes: readonly InvoiceAnnex[];
  paymentDue: PaymentDueRule;
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
/** Hours are shown as stored. */
const EXACT = { maxDp: SCALE.amount } as const;

/**
 * The rate with the fewest decimals, 2 to 8, at which qty × rate still rounds to the line amount
 * (A-134): 47.00, 23.8095 for 4000 / 168 × 168, 32.738095 for 5500 / 168 × 176.
 */
export function printedRate(quantity: string, unitPrice: string, amount: string): string {
  const target = roundHalfUp(amount);
  for (let dp = 2; dp < SCALE.amount; dp++) {
    const rate = roundHalfUp(unitPrice, dp);
    if (roundHalfUp(rate.times(quantity)).eq(target)) {
      return formatAmount(rate, undefined, { maxDp: dp });
    }
  }
  return formatAmount(unitPrice, undefined, EXACT);
}

export function buildInvoiceSnapshot(i: SnapshotInput) {
  const date = formatUaDate(i.issueDate);
  const period = i.periodMonth
    ? {
        from: formatUaDate(i.periodMonth),
        to: formatUaDate(endOfMonth(i.periodMonth)),
        text_ua: `з ${formatUaDate(i.periodMonth)} року по ${formatUaDate(endOfMonth(i.periodMonth))} року`,
      }
    : { from: '', to: '', text_ua: '' };
  const annexes = annexReference(i.annexes);
  return {
    version: 2,
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
      annexes_en: annexes.en,
      annexes_ua: annexes.ua,
      annexes_short_en: annexes.short_en,
      annexes_short_ua: annexes.short_ua,
    },
    payment: paymentTerms(i.paymentDue),
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
      qty: formatAmount(l.quantity, undefined, EXACT),
      price: printedRate(l.quantity, l.unitPrice, l.amount),
      amount: formatAmount(l.amount),
    })),
  };
}

export type InvoiceSnapshot = ReturnType<typeof buildInvoiceSnapshot>;

/**
 * Snapshots frozen before version 2 lack the payment and annex placeholders; they get the text the
 * template had hardcoded when they were issued, so a re-render prints the same document.
 */
export function withTemplateDefaults(snapshot: InvoiceSnapshot): InvoiceSnapshot {
  if (snapshot.version >= 2) return snapshot;
  return {
    ...snapshot,
    contract: {
      ...snapshot.contract,
      annexes_en: ' and Exhibit A of this Agreement',
      annexes_ua: ' та Додатку А до цієї угоди',
      annexes_short_en: ' (Exhibit A)',
      annexes_short_ua: ' (Додаток А)',
    },
    payment: paymentTerms({ type: 'net_days', days: 20 }),
  };
}
