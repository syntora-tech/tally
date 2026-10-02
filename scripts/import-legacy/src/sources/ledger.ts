import {
  addDays,
  localDate,
  parseCryptoNetwork,
  sum,
  toDecimal,
  type LocalDate,
} from '@tally/domain';
import type { Anomaly } from '../model';
import { decimal, text } from '../cells';
import { cellAt, ref, type Book, type Sheet } from '../workbook';

export type LedgerTxType =
  | 'revenue'
  | 'expense'
  | 'transfer'
  | 'fx_exchange'
  | 'crypto_buy'
  | 'crypto_sell'
  | 'crypto_swap'
  | 'adjustment';

const TYPES: Record<string, LedgerTxType> = {
  revenue: 'revenue',
  expense: 'expense',
  transfer: 'transfer',
  'fx exchange': 'fx_exchange',
  'crypto buy': 'crypto_buy',
  'crypto sell': 'crypto_sell',
  'crypto swap': 'crypto_swap',
  adjustment: 'adjustment',
};

const FIAT = new Set(['USD', 'EUR', 'UAH']);

export type LedgerAccount = {
  ref: string;
  name: string;
  kind: 'bank' | 'crypto' | 'cash';
  currency: string;
  network: string | null;
  openingBalance: string;
};

export type LedgerPosting = { account: string; amount: string; isFee: boolean };

export type LedgerTransaction = {
  ref: string;
  occurredOn: LocalDate;
  type: LedgerTxType;
  category: string;
  description: string | null;
  postings: LedgerPosting[];
};

export type LedgerRate = { onDate: LocalDate; base: string; quote: string; rate: string };

export type Reconciliation = {
  account: string;
  currency: string;
  expected: string | null;
  computed: string;
  ok: boolean;
};

export type LedgerModel = {
  accounts: LedgerAccount[];
  categories: { type: LedgerTxType; name: string }[];
  transactions: LedgerTransaction[];
  rates: LedgerRate[];
  openingDate: LocalDate;
  reconciliation: Reconciliation[];
  treasuryUsd: { expected: string | null; computed: string };
  anomalies: Anomaly[];
};

/** Excel serial day → LocalDate (1900 date system, serial 1 = 1900-01-01 with the leap bug). */
export function excelDate(value: unknown): LocalDate | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return addDays(localDate(1899, 12, 30), Math.floor(value));
}

function rows(sheet: Sheet | undefined) {
  return (sheet?.rows ?? []).slice(1).map((row, i) => ({ row, r: i + 1 }));
}

/** Fiat amounts keep cents; formulas like 1400.2/1.168 leave long tails (A11). */
function amountFor(currency: string, value: string): string {
  return FIAT.has(currency) ? toDecimal(value).toDecimalPlaces(2).toString() : value;
}

/**
 * `Syntora_Ledger` (spec 8.1): accounts, categories, transactions with fees as separate negative
 * postings, FX rates. Postings use the account currency (A10); fiat amounts are rounded to cents
 * (A11, Q5). Balances and Treasury_USD are only used for the 8.3 reconciliation.
 */
export function parseLedger(book: Book): LedgerModel {
  const anomalies: Anomaly[] = [];
  const accountsSheet = book.sheets.get('Accounts');
  const accounts: LedgerAccount[] = rows(accountsSheet)
    .filter(({ row }) => text(row[1]?.v))
    .map(({ row }) => {
      const kind = text(row[2]?.v).toLowerCase();
      const rawNetwork = text(row[4]?.v);
      const network = rawNetwork ? parseCryptoNetwork(rawNetwork) : null;
      if (rawNetwork && !network) {
        anomalies.push({
          code: 'ledger_network_unknown',
          ref: `ledger:account:${text(row[1]?.v)}`,
          message: `Невідома мережа «${rawNetwork}» — рахунок імпортовано без мережі`,
        });
      }
      return {
        ref: `ledger:account:${text(row[1]?.v)}`,
        name: text(row[1]?.v),
        kind: kind === 'crypto' ? 'crypto' : kind === 'cash' ? 'cash' : 'bank',
        currency: text(row[3]?.v).toUpperCase(),
        network,
        openingBalance: decimal(row[5]?.v) ?? '0',
      } satisfies LedgerAccount;
    });
  const currencyOf = new Map(accounts.map((a) => [a.name, a.currency]));

  const categories = rows(book.sheets.get('Categories'))
    .map(({ row }) => ({ type: TYPES[text(row[0]?.v).toLowerCase()], name: text(row[1]?.v) }))
    .filter((c): c is { type: LedgerTxType; name: string } => Boolean(c.type && c.name));

  const txSheet = book.sheets.get('Transactions');
  const transactions: LedgerTransaction[] = [];
  for (const { r } of rows(txSheet)) {
    if (!txSheet) break;
    const at = (c: number) => cellAt(txSheet, r, c).v;
    const occurredOn = excelDate(at(0));
    const rawType = text(at(1));
    if (!occurredOn && !rawType) continue;
    const rowRef = ref(txSheet, r);
    const type = TYPES[rawType.toLowerCase()];
    if (!occurredOn || !type) {
      anomalies.push({
        code: 'ledger_row_skipped',
        ref: rowRef,
        message: `Немає дати або невідомий тип «${rawType}»`,
      });
      continue;
    }
    const postings: LedgerPosting[] = [];
    const leg = (accountCol: number, amountCol: number, currencyCol: number, sign: 1 | -1) => {
      const accountName = text(at(accountCol));
      const amount = decimal(at(amountCol));
      if (!accountName || amount === null) return;
      const currency = currencyOf.get(accountName);
      if (!currency) {
        anomalies.push({
          code: 'ledger_unknown_account',
          ref: rowRef,
          message: `Невідомий рахунок «${accountName}»`,
        });
        return;
      }
      const stated = text(at(currencyCol)).toUpperCase();
      if (stated && stated !== currency) {
        anomalies.push({
          code: 'ledger_currency_mismatch',
          ref: rowRef,
          message: `Валюта ${stated} на рахунку ${accountName} (${currency}) — імпортовано у валюті рахунку (A10)`,
        });
      }
      const rounded = amountFor(currency, toDecimal(amount).abs().toString());
      if (!toDecimal(rounded).eq(toDecimal(amount).abs())) {
        anomalies.push({
          code: 'ledger_amount_rounded',
          ref: rowRef,
          message: `${amount} ${currency} округлено до ${rounded} (A11)`,
        });
      }
      if (toDecimal(rounded).isZero()) return;
      postings.push({
        account: accountName,
        amount: sign < 0 ? toDecimal(rounded).neg().toString() : rounded,
        isFee: false,
      });
    };
    if (type === 'revenue') leg(4, 7, 8, 1);
    else if (type === 'expense') leg(3, 5, 6, -1);
    else if (type === 'adjustment') {
      leg(3, 5, 6, -1);
      leg(4, 7, 8, 1);
    } else {
      leg(3, 5, 6, -1);
      leg(4, 7, 8, 1);
    }
    // Revenue/expense rows sometimes fill only the "from"/"to" side the other way round.
    if (postings.length === 0 && (type === 'revenue' || type === 'expense')) {
      if (type === 'revenue') leg(3, 5, 6, 1);
      else leg(4, 7, 8, -1);
    }
    const fee = decimal(at(10));
    const feeAccount = text(at(11)) || text(at(3)) || text(at(4));
    if (fee !== null && !toDecimal(fee).isZero()) {
      const currency = currencyOf.get(feeAccount);
      if (currency) {
        postings.push({
          account: feeAccount,
          amount: toDecimal(amountFor(currency, toDecimal(fee).abs().toString()))
            .neg()
            .toString(),
          isFee: true,
        });
      }
    }
    if (postings.filter((p) => !p.isFee).length === 0) {
      anomalies.push({
        code: 'ledger_row_skipped',
        ref: rowRef,
        message: 'Рядок без суми — пропущено',
      });
      continue;
    }
    transactions.push({
      ref: `ledger:${rowRef.replace(/^ledger:/, '')}`,
      occurredOn,
      type,
      category: text(at(2)),
      description: text(at(12)) || null,
      postings,
    });
  }

  // FX_Rates holds "1 unit = x USD"; stored as quote per base for the pairs that matter (A13).
  const rates: LedgerRate[] = [];
  for (const { row } of rows(book.sheets.get('FX_Rates'))) {
    const onDate = excelDate(row[0]?.v);
    const currency = text(row[1]?.v).toUpperCase();
    const toUsd = decimal(row[2]?.v);
    if (!onDate || !toUsd || ['USD', 'USDT', 'USDC'].includes(currency)) continue;
    rates.push(
      currency === 'UAH'
        ? {
            onDate,
            base: 'USD',
            quote: 'UAH',
            rate: toDecimal('1').div(toUsd).toDecimalPlaces(6).toString(),
          }
        : {
            onDate,
            base: currency,
            quote: 'USD',
            rate: toDecimal(toUsd).toDecimalPlaces(6).toString(),
          },
    );
  }

  const openingDate = transactions.map((t) => t.occurredOn).sort()[0] ?? localDate(2026, 1, 1);

  const balances = new Map(
    rows(book.sheets.get('Balances'))
      .filter(({ row }) => text(row[0]?.v))
      .map(({ row }) => [text(row[0]?.v), decimal(row[7]?.v)]),
  );
  const reconciliation: Reconciliation[] = accounts.map((a) => {
    const computed = sum([
      a.openingBalance,
      ...transactions.flatMap((t) =>
        t.postings.filter((p) => p.account === a.name).map((p) => p.amount),
      ),
    ]);
    const expected = balances.get(a.name) ?? null;
    return {
      account: a.name,
      currency: a.currency,
      expected:
        expected === null
          ? null
          : toDecimal(expected)
              .toDecimalPlaces(a.kind === 'crypto' ? 8 : 2)
              .toString(),
      computed: computed.toDecimalPlaces(8).toString(),
      ok: expected === null ? false : computed.minus(expected).abs().lte('0.01'),
    };
  });

  const usdRate = (currency: string) => {
    if (['USD', 'USDT', 'USDC'].includes(currency)) return toDecimal('1');
    const r = rates.find((x) => x.base === currency && x.quote === 'USD');
    if (r) return toDecimal(r.rate);
    const uah = rates.find((x) => x.base === 'USD' && x.quote === currency);
    return uah ? toDecimal('1').div(uah.rate) : toDecimal('0');
  };
  const treasury = sum(
    reconciliation.map((r) => toDecimal(r.computed).times(usdRate(r.currency))),
  ).toDecimalPlaces(2);
  const treasurySheet = book.sheets.get('Treasury_USD');
  const expectedTreasury = treasurySheet ? decimal(cellAt(treasurySheet, 1, 7).v) : null;

  return {
    accounts,
    categories,
    transactions,
    rates,
    openingDate,
    reconciliation,
    treasuryUsd: {
      expected:
        expectedTreasury === null
          ? null
          : toDecimal(expectedTreasury).toDecimalPlaces(2).toString(),
      computed: treasury.toString(),
    },
    anomalies,
  };
}
