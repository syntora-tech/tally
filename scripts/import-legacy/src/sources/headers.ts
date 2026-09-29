import { parseUaDate, type LocalDate } from '@tally/domain';
import { text } from '../cells';
import { cellAt, ref, type Book, type Sheet } from '../workbook';

const lines = (v: unknown) =>
  (typeof v === 'string' ? v : '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);

const date = (s: string | undefined): LocalDate | null => {
  if (!s) return null;
  const d = parseUaDate(s);
  return d.isOk() ? d.value : null;
};

export type InvoiceHeader = {
  sheet: string;
  ref: string;
  contractNumber: string | null;
  contractDate: LocalDate | null;
  /** "SOW #1", "Annex 3" — maps calc rows to this client. */
  sowRef: string | null;
  customer: { legalName: string; address: string | null; bankDetails: string | null };
  supplier: {
    nameEn: string | null;
    nameUa: string | null;
    addressEn: string | null;
    addressUa: string | null;
    directorEn: string | null;
    directorUa: string | null;
    legalCode: string | null;
    bankDetailsEn: string | null;
  };
};

const CONTRACT_RE =
  /(?:Master Services Agreement|CONTRACT for Works and Services)\s*(?:№|No)\s*(\S+)\s+dated\s+(\d{2}\.\d{2}\.\d{4})/i;

/** Client invoice sheets (SOW #*, Switzerland, IdeaSoft Annex 3): requisites of both parties. */
export function parseInvoiceHeader(sheet: Sheet): InvoiceHeader | null {
  const find = (prefix: RegExp) => {
    for (let r = 0; r < Math.min(sheet.rows.length, 15); r++) {
      const v = cellAt(sheet, r, 0).v;
      if (prefix.test(text(v))) return { r, v };
    }
    return null;
  };
  const customerCell = find(/^Customer:/i);
  if (!customerCell) return null;
  const [first = '', ...rest] = lines(customerCell.v);
  const customerName = first.replace(/^Customer:\s*/i, '').trim();
  const agreement = find(/^to (the|CONTRACT)\b/i);
  const agreementText = agreement ? text(agreement.v) : '';
  const contract = CONTRACT_RE.exec(agreementText);
  const sow = /STATEMENT OF WORK #(\d+)/i.exec(agreementText) ?? null;
  const annex = /\(Annex (\d+)\)/i.exec(agreementText) ?? null;

  const bankCell = find(/^Customer Bank information:/i);
  const bank = bankCell ? lines(bankCell.v).slice(1) : [];
  const supplierCell = find(/^Supplier:/i);
  const supEn = supplierCell ? lines(supplierCell.v) : [];
  const supUa = supplierCell ? lines(cellAt(sheet, supplierCell.r, 1).v) : [];
  const supBank = bankCell ? lines(cellAt(sheet, bankCell.r, 1).v).slice(1) : [];
  const after = (arr: string[], re: RegExp) =>
    arr
      .find((l) => re.test(l))
      ?.replace(re, '')
      .trim() ?? null;

  return {
    sheet: sheet.name,
    ref: ref(sheet, customerCell.r),
    contractNumber: contract?.[1] ?? null,
    contractDate: date(contract?.[2]),
    sowRef: sow ? `SOW #${sow[1] ?? ''}` : annex ? `Annex ${annex[1] ?? ''}` : null,
    customer: {
      legalName: customerName,
      address: rest.join('\n') || null,
      bankDetails: bank.some((l) => !/:\s*-\s*$/.test(l)) ? bank.join('\n') : null,
    },
    supplier: {
      nameEn: supEn[0]?.replace(/^Supplier:\s*/i, '').trim() ?? null,
      nameUa:
        supUa[0]
          ?.replace(/^Постачальник:\s*/i, '')
          .replace(/,$/, '')
          .trim() ?? null,
      addressEn: after(supEn, /^Company address:\s*/i),
      addressUa: after(supUa, /^Адреса:\s*/i),
      directorEn: after(supEn, /^Represented by\s*/i),
      directorUa: after(supUa, /^В особі\s*/i),
      legalCode: after(supEn, /^Company number:\s*/i) ?? after(supUa, /^ЄДРПОУ:\s*/i),
      bankDetailsEn: supBank.join('\n') || null,
    },
  };
}

export type ActHeader = {
  sheet: string;
  ref: string;
  contractNumber: string | null;
  contractDate: LocalDate | null;
  legalNameUa: string | null;
  taxId: string | null;
  addressUa: string | null;
  iban: string | null;
  bankName: string | null;
  edrRecord: string | null;
  edrDate: LocalDate | null;
};

/** FOP act sheets (Акт *): payee requisites and the FOP contract number/date (spec 8.1). */
export function parseActHeader(sheet: Sheet): ActHeader | null {
  let title = '';
  let performer: string[] = [];
  let preamble = '';
  for (let r = 0; r < Math.min(sheet.rows.length, 30); r++) {
    const a = text(cellAt(sheet, r, 0).v);
    if (/^Акт прийому-передачі/i.test(a)) title = a;
    if (/фізична особа-підприємець/i.test(a)) preamble = a;
    for (const cell of sheet.rows[r] ?? []) {
      if (/^Виконавець:/i.test(text(cell.v))) performer = lines(cell.v);
    }
  }
  if (!title && performer.length === 0) return null;
  const contract = /за Договором\s*№\s*(\S+)\s+від\s+(\d{2}\.\d{2}\.\d{4})/i.exec(title);
  const field = (re: RegExp) =>
    performer
      .find((l) => re.test(l))
      ?.replace(re, '')
      .trim() ?? null;
  const addressIndex = performer.findIndex((l) => /^Адреса:/i.test(l));
  const accountIndex = performer.findIndex((l) => /^Р\/р/i.test(l));
  const address =
    addressIndex >= 0
      ? performer
          .slice(addressIndex, accountIndex > addressIndex ? accountIndex : addressIndex + 1)
          .join(' ')
          .replace(/^Адреса:\s*/i, '')
      : null;
  const bankLine = accountIndex >= 0 ? performer[accountIndex + 1] : undefined;
  const iban = performer.join(' ').match(/UA\d{27}/)?.[0] ?? null;
  const edr = /формувань\s+(\d+)\s+від\s+(\d{2}\.\d{2}\.\d{4})/i.exec(preamble);

  return {
    sheet: sheet.name,
    ref: ref(sheet, 0),
    contractNumber: contract?.[1] ?? null,
    contractDate: date(contract?.[2]),
    legalNameUa: performer.find((l) => /^ФОП\s/i.test(l)) ?? null,
    taxId: field(/^(ІПН|Ідентифікаційний код):\s*/i),
    addressUa: address,
    iban,
    bankName:
      bankLine && !/^UA\d/.test(bankLine)
        ? bankLine.replace(/,\s*$/, '').replace(/[“”]/g, '"')
        : null,
    edrRecord: edr?.[1] ?? null,
    edrDate: date(edr?.[2]),
  };
}

export function parseHeaders(book: Book) {
  const invoices: InvoiceHeader[] = [];
  const acts: ActHeader[] = [];
  for (const sheet of book.sheets.values()) {
    if (/^Акт /i.test(sheet.name)) {
      const act = parseActHeader(sheet);
      if (act) acts.push(act);
    } else if (
      !/^(Current|Копія|January|February|March|April|May|June|July|Annual)/i.test(sheet.name)
    ) {
      const inv = parseInvoiceHeader(sheet);
      if (inv) invoices.push(inv);
    }
  }
  return { invoices, acts };
}
