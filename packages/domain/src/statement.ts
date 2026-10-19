import { err, ok, type Result } from 'neverthrow';
import { parseLocalDate, parseUaDate, diffDays, type LocalDate } from './local-date';
import { Decimal, toDecimal } from './money';

/**
 * Bank statement import (spec 6.7, A-121): a table read from CSV/XLSX → normalised rows. Columns
 * are found by their header names, so the bank may reorder or add columns between exports.
 */

export type StatementField =
  | 'date'
  | 'time'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'currency'
  | 'ref'
  | 'docNumber'
  | 'purpose'
  | 'counterparty'
  | 'counterpartyTaxId'
  | 'counterpartyAccount'
  | 'ourAccount'
  | 'balance';

/** Header names after `headerKey`, best first; a later entry is used only when no earlier one is present. */
const HEADERS: Record<StatementField, readonly string[]> = {
  date: ['датаоперації', 'датапроводки', 'датаопераціі', 'дата', 'date'],
  time: ['час', 'часоперації', 'time'],
  debit: ['дебет', 'сумадебет', 'видаток', 'списання', 'debit'],
  credit: ['кредит', 'сумакредит', 'надходження', 'зарахування', 'credit'],
  amount: ['сума', 'сумаоперації', 'сумаувалютірахунку', 'amount'],
  currency: ['валюта', 'валютарахунку', 'currency'],
  ref: ['референс', 'референсоперації', 'референспроводки', 'ref', 'reference'],
  docNumber: ['номердокумента', 'документ', 'номердок', 'document'],
  purpose: ['призначенняплатежу', 'призначення', 'деталіплатежу', 'purpose', 'details'],
  counterparty: [
    'кореспондент',
    'контрагент',
    'назвакореспондента',
    'назваконтрагента',
    'отримувачвідправник',
    'counterparty',
  ],
  counterpartyTaxId: [
    'єдрпоукореспондента',
    'єдрпоуконтрагента',
    'кодкореспондента',
    'кодконтрагента',
    'єдрпоуіпнконтрагента',
    'іпнконтрагента',
  ],
  counterpartyAccount: [
    'рахуноккореспондента',
    'рахунокконтрагента',
    'ibanкореспондента',
    'ibanконтрагента',
  ],
  ourAccount: ['рахунок', 'номеррахунку', 'iban', 'account'],
  balance: ['залишок', 'залишокпісляоперації', 'вихіднийзалишок', 'balance'],
};

/** Lower case, Latin look-alikes as Cyrillic (statements mix «I» and «І»), letters and digits only. */
export function headerKey(raw: string): string {
  return normalizeText(raw).replace(/[^\p{L}\p{N}]/gu, '');
}

const LOOKALIKES: Record<string, string> = { i: 'і', ï: 'ї' };

/** Text for matching only: lower case, Latin i as Cyrillic і, single spaces. */
export function normalizeText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[iï]/g, (c) => LOOKALIKES[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Both spellings, so Cyrillic patterns see «і» and English words keep their Latin «i». */
const searchable = (raw: string) => `${normalizeText(raw)} || ${raw.toLowerCase()}`;

export type StatementRow = {
  /** 1-based row number in the file, for messages. */
  line: number;
  occurredOn: LocalDate;
  direction: 'in' | 'out';
  /** Positive decimal string as in the statement. */
  amount: string;
  currency: string | null;
  ref: string | null;
  docNumber: string | null;
  purpose: string | null;
  counterparty: string | null;
  counterpartyTaxId: string | null;
  counterpartyAccount: string | null;
  ourAccount: string | null;
  /** Account balance after the row, when the export has it. */
  balance: string | null;
};

export type ParsedStatement = {
  columns: Partial<Record<StatementField, string>>;
  rows: StatementRow[];
  /** Our account number/IBAN when every row names the same one. */
  ourAccount: string | null;
  currency: string | null;
  /** Rows without a date or an amount (totals, blank lines) that were left out. */
  skipped: number;
  /** Bad cells of rows that look like operations: `line: field`. */
  problems: { line: number; field: StatementField; value: string }[];
};

export type StatementError =
  | { code: 'empty' }
  | { code: 'unknown_format'; headers: string[] }
  | { code: 'mixed_accounts'; accounts: string[] };

const HEADER_SCAN_ROWS = 30;

function findColumns(header: readonly string[]) {
  const keys = header.map(headerKey);
  const columns: Partial<Record<StatementField, number>> = {};
  const taken = new Set<number>();
  // Most specific fields first, so «Рахунок кореспондента» is not taken as our «Рахунок».
  const order: StatementField[] = [
    'counterpartyTaxId',
    'counterpartyAccount',
    'counterparty',
    'docNumber',
    'purpose',
    'ref',
    'date',
    'time',
    'debit',
    'credit',
    'amount',
    'currency',
    'balance',
    'ourAccount',
  ];
  for (const field of order) {
    for (const name of HEADERS[field]) {
      const index = keys.findIndex((k, i) => k === name && !taken.has(i));
      if (index >= 0) {
        columns[field] = index;
        taken.add(index);
        break;
      }
    }
  }
  return columns;
}

const hasMoney = (c: Partial<Record<StatementField, number>>) =>
  c.amount !== undefined || c.debit !== undefined || c.credit !== undefined;

/**
 * Bank amount in any common spelling — `1 234,56`, `1,234.56`, `-1234.56`, `+12` — as a decimal
 * string; null when the cell is not a number.
 */
export function parseBankAmount(raw: string): Decimal | null {
  let s = raw.replace(/[\s\u00a0\u202f']/g, '').replace(/^\+/, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replaceAll('.', '').replace(',', '.') : s.replaceAll(',', '');
  } else if (lastComma >= 0) {
    s =
      /,\d{3}$/.test(s) && s.indexOf(',') !== lastComma
        ? s.replaceAll(',', '')
        : s.replace(',', '.');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = new Decimal(s);
  return negative ? value.neg() : value;
}

/** `19.10.2026`, `19.10.2026 14:22`, `2026-10-19`, `19/10/2026`, or an Excel serial day number. */
export function parseBankDate(raw: string): LocalDate | null {
  const s = raw.trim().split(/[ T]/)[0] ?? '';
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    // Excel serial date (1900 system): day 25569 = 1970-01-01.
    const days = Math.floor(Number(s)) - 25569;
    const iso = new Date(days * 86_400_000).toISOString().slice(0, 10);
    return parseLocalDate(iso).unwrapOr(null);
  }
  const ua = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (ua) {
    const [, d = '', m = '', y = ''] = ua;
    return parseUaDate(`${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`).unwrapOr(null);
  }
  return parseLocalDate(s).unwrapOr(null);
}

const cell = (row: readonly string[], index: number | undefined) =>
  index === undefined ? null : (row[index] ?? '').trim() || null;

/**
 * Reads statement rows from a table. The header is the first of the top rows that names a date
 * and an amount column; rows without a date and a non-zero amount (totals, blank lines) are left
 * out and counted.
 */
export function parseStatementTable(
  table: readonly (readonly string[])[],
): Result<ParsedStatement, StatementError> {
  const nonEmpty = table.filter((r) => r.some((c) => c.trim()));
  if (!nonEmpty.length) return err({ code: 'empty' });
  let headerIndex = -1;
  let found: Partial<Record<StatementField, number>> = {};
  for (const [i, row] of table.slice(0, HEADER_SCAN_ROWS).entries()) {
    const columns = findColumns(row);
    if (columns.date !== undefined && hasMoney(columns)) {
      headerIndex = i;
      found = columns;
      break;
    }
  }
  if (headerIndex < 0) {
    return err({
      code: 'unknown_format',
      headers: (nonEmpty[0] ?? []).map((c) => c.trim()).filter(Boolean),
    });
  }
  const header = table[headerIndex] ?? [];
  const rows: StatementRow[] = [];
  const problems: ParsedStatement['problems'] = [];
  let skipped = 0;
  for (const [offset, row] of table.slice(headerIndex + 1).entries()) {
    const line = headerIndex + offset + 2;
    const rawDate = cell(row, found.date);
    const occurredOn = rawDate ? parseBankDate(rawDate) : null;
    const debit = parseBankAmount(cell(row, found.debit) ?? '');
    const credit = parseBankAmount(cell(row, found.credit) ?? '');
    const signed = parseBankAmount(cell(row, found.amount) ?? '');
    let direction: 'in' | 'out' | null = null;
    let amount: Decimal | null = null;
    if (debit && !debit.isZero()) {
      direction = debit.isNeg() ? 'in' : 'out';
      amount = debit.abs();
    } else if (credit && !credit.isZero()) {
      direction = credit.isNeg() ? 'out' : 'in';
      amount = credit.abs();
    } else if (signed && !signed.isZero()) {
      direction = signed.isNeg() ? 'out' : 'in';
      amount = signed.abs();
    }
    if (!occurredOn || !direction || !amount) {
      if (rawDate && !occurredOn && (debit || credit || signed)) {
        problems.push({ line, field: 'date', value: rawDate });
      }
      skipped++;
      continue;
    }
    const balance = parseBankAmount(cell(row, found.balance) ?? '');
    rows.push({
      line,
      occurredOn,
      direction,
      amount: amount.toFixed(),
      currency: cell(row, found.currency)?.toUpperCase() ?? null,
      ref: cell(row, found.ref),
      docNumber: cell(row, found.docNumber),
      purpose: cell(row, found.purpose),
      counterparty: cell(row, found.counterparty),
      counterpartyTaxId: cell(row, found.counterpartyTaxId)?.replace(/\s/g, '') ?? null,
      counterpartyAccount: cell(row, found.counterpartyAccount)?.replace(/\s/g, '') ?? null,
      ourAccount: cell(row, found.ourAccount)?.replace(/\s/g, '') ?? null,
      balance: balance ? balance.toFixed() : null,
    });
  }
  const accounts = [...new Set(rows.flatMap((r) => (r.ourAccount ? [r.ourAccount] : [])))];
  if (accounts.length > 1) return err({ code: 'mixed_accounts', accounts });
  const currencies = [...new Set(rows.flatMap((r) => (r.currency ? [r.currency] : [])))];
  const columns: ParsedStatement['columns'] = {};
  for (const [field, index] of Object.entries(found) as [StatementField, number][]) {
    columns[field] = (header[index] ?? '').trim();
  }
  return ok({
    columns,
    rows,
    ourAccount: accounts[0] ?? null,
    currency: currencies.length === 1 ? (currencies[0] ?? null) : null,
    skipped,
    problems,
  });
}

/**
 * Stable de-duplication key of a statement row (A-121), the same as agents used before the
 * importer existed (mcp-agent-guide 7.2): the bank reference when the export has one, otherwise
 * account tail + date + document number + amount.
 */
export function statementExternalRef(row: StatementRow, accountTail: string | null): string {
  if (row.ref) return `privat:${row.ref}`;
  const amount = toDecimal(row.amount).toFixed(2);
  const doc = row.docNumber ?? `line${String(row.line)}`;
  return ['privat', accountTail, row.occurredOn, doc, amount].filter(Boolean).join(':');
}

/** Last four digits of an account number or IBAN, as used in `statementExternalRef`. */
export function accountTail(account: string | null): string | null {
  const digits = account?.replace(/\D/g, '') ?? '';
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export type StatementRule = {
  type: 'revenue' | 'expense';
  category: string;
};

const has = (text: string, ...patterns: RegExp[]) => patterns.some((p) => p.test(text));

/** Whole word for Cyrillic too (`\b` only knows ASCII letters). */
const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'u');

/**
 * Built-in default categories by what a row says (mcp-agent-guide 7.3). The history of the same
 * counterparty wins over these in the importer; a row that fits nothing gets no suggestion.
 */
export function ruleCategory(row: {
  direction: 'in' | 'out';
  purpose: string | null;
  counterparty: string | null;
}): StatementRule | null {
  const text = searchable(`${row.counterparty ?? ''} | ${row.purpose ?? ''}`);
  if (row.direction === 'out') {
    if (
      has(
        text,
        word('дпс'),
        /дксу/,
        /казначейств/,
        word('єсв'),
        /пдфо/,
        /військов\S* збір/,
        /єдин\S* податок/,
        word('пдв'),
        /податк/,
      )
    ) {
      return { type: 'expense', category: 'Taxes' };
    }
    if (has(text, /коміс/, /обслуговування (поточн\S* )?рахунк/, /\bcommission\b/, /\bbank fee/)) {
      return { type: 'expense', category: 'Bank Fees' };
    }
    if (has(text, /зароб\S* плат/, /зарплат/)) return { type: 'expense', category: 'Payroll' };
    if (has(text, /бухгалтер/, /юридичн/))
      return { type: 'expense', category: 'Legal / Accounting' };
    return null;
  }
  if (has(text, /відсот/, /процент/, /\binterest\b/, /кешбек/, /повернення/)) {
    return { type: 'revenue', category: 'Interest / Other Income' };
  }
  if (has(text, /^from /, /\| from /, /\binvoice/, /інвойс/, /\bswift\b/)) {
    return { type: 'revenue', category: 'Client Revenue' };
  }
  return null;
}

/** A row of several statements, with its account, for pairing across files. */
export type PairingRow = {
  key: string;
  accountId: string;
  currency: string;
  occurredOn: LocalDate;
  direction: 'in' | 'out';
  amount: string;
  ref: string | null;
  docNumber: string | null;
  purpose: string | null;
  counterpartyAccount: string | null;
  ourAccount: string | null;
};

export type Pairing = {
  /** Credit leg of an exchange or own transfer → key of its debit row. */
  counterOf: Map<string, string>;
  /** Bank fee row → key of the payment or exchange it belongs to. */
  feeOf: Map<string, string>;
};

const FX_WORDS = /(продаж|купів|купл|обмін|конверт|exchange)/;

/** «… 600.00 USD …» → `600.00 USD` normalised, for matching both legs of an exchange. */
function mentionedForeignAmounts(purpose: string | null): string[] {
  if (!purpose) return [];
  const out: string[] = [];
  for (const m of purpose.matchAll(/(\d[\d\s]*(?:[.,]\d+)?)\s*(USD|EUR|GBP|PLN|CHF)\b/gi)) {
    const value = parseBankAmount(m[1] ?? '');
    if (value) out.push(`${value.toFixed(2)} ${(m[2] ?? '').toUpperCase()}`);
  }
  return out;
}

const isFeeRow = (r: PairingRow) =>
  r.direction === 'out' && /коміс|commission|\bfee\b/.test(searchable(r.purpose ?? ''));

const isServiceCharge = (r: PairingRow) =>
  /обслуговування/.test(normalizeText(r.purpose ?? '')) &&
  !/переказ|платіж|продаж/.test(normalizeText(r.purpose ?? ''));

const within = (a: LocalDate, b: LocalDate, days: number) => Math.abs(diffDays(a, b)) <= days;

/**
 * Proposes which rows of the uploaded statements are one transaction (mcp-agent-guide 7.4):
 * the two legs of a currency exchange or of a transfer between our own accounts, and bank fees
 * of a specific payment. Only rows with clear evidence are paired; everything else stays a row
 * of its own and can be attached by hand in the preview.
 */
export function pairStatementRows(rows: readonly PairingRow[]): Pairing {
  const counterOf = new Map<string, string>();
  const feeOf = new Map<string, string>();
  const used = new Set<string>();

  const debits = rows.filter((r) => r.direction === 'out' && !isFeeRow(r));
  for (const credit of rows.filter((r) => r.direction === 'in')) {
    const creditText = searchable(credit.purpose ?? '');
    const creditMentions = mentionedForeignAmounts(credit.purpose);
    const candidates = debits.filter((d) => {
      if (used.has(d.key) || d.accountId === credit.accountId) return false;
      if (!within(d.occurredOn, credit.occurredOn, 1)) return false;
      if (d.currency !== credit.currency) {
        if (!FX_WORDS.test(creditText) && !FX_WORDS.test(searchable(d.purpose ?? ''))) {
          return false;
        }
        const foreign = [d, credit].find((r) => r.currency !== 'UAH') ?? d;
        const amount = `${toDecimal(foreign.amount).toFixed(2)} ${foreign.currency}`;
        return (
          creditMentions.includes(amount) || mentionedForeignAmounts(d.purpose).includes(amount)
        );
      }
      // Same currency: only when the debit went to the account that received the credit.
      return (
        toDecimal(d.amount).eq(credit.amount) &&
        Boolean(d.counterpartyAccount && credit.ourAccount) &&
        d.counterpartyAccount === credit.ourAccount
      );
    });
    if (candidates.length !== 1) continue;
    const [debit] = candidates;
    if (!debit) continue;
    counterOf.set(credit.key, debit.key);
    used.add(debit.key);
  }

  const mains = rows.filter((r) => !isFeeRow(r) && !counterOf.has(r.key));
  const feeTaken = new Set<string>();
  for (const fee of rows.filter(isFeeRow)) {
    if (isServiceCharge(fee)) continue;
    const text = normalizeText(fee.purpose ?? '');
    const mentions = mentionedForeignAmounts(fee.purpose);
    const sameDay = mains.filter(
      (m) => !feeTaken.has(m.key) && m.key !== fee.key && within(m.occurredOn, fee.occurredOn, 1),
    );
    const byReference = sameDay.filter((m) =>
      [m.ref, m.docNumber].some(
        (id) =>
          id &&
          id.length >= 2 &&
          new RegExp(
            `(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizeText(id))}([^\\p{L}\\p{N}]|$)`,
            'u',
          ).test(text),
      ),
    );
    const byAmount = byReference.length
      ? byReference
      : sameDay.filter((m) => mentions.includes(`${toDecimal(m.amount).toFixed(2)} ${m.currency}`));
    const [target] = byAmount;
    if (byAmount.length !== 1 || !target) continue;
    feeOf.set(fee.key, target.key);
    feeTaken.add(target.key);
  }
  return { counterOf, feeOf };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
