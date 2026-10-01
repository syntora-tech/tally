import * as XLSX from 'xlsx';
import { sheetFromWorkbook, type Book } from '../src/workbook';

type Row = (string | number | null)[];

const CALC_HEADER: Row = [
  'Employee ',
  'Partner company',
  'SOW',
  'Based on',
  'FTE',
  'Logged Work Hours ',
  'Percent of logged Hours ',
  'Invoice Type according to SOW',
  'Month Payment according to SOW',
  '$/hours ',
  'Summary for invoices ',
  'Invoice to a partner',
  'Employee Payment Type',
  'Fix Salary ',
  'Currant Salary Paymant',
  'UAH',
  'Період роботи працівника',
  'Prepayment way',
  'Invoice',
  'Paid to employee ',
  null,
  'Курс 1USD',
  'Work Hours in Month',
];

/** One calc row: employee, partner, role, basedOn, fte, hours, invoiceType, monthPay, hourRate, invoiceTo, payType, salary, prepayment. */
export function calcRow(r: {
  employee: string;
  partner: string;
  role: string;
  basedOn?: string;
  fte?: number;
  hours?: number;
  invoiceType: string;
  monthPayment?: number | string;
  hourRate?: number;
  invoiceTo?: string;
  payType: string;
  fixSalary?: number | string;
  prepayment?: string;
  /** Month-level values; the parser reads them from the first data row. */
  fx?: number;
  workHours?: number;
}): Row {
  return [
    r.employee,
    r.partner,
    r.role,
    r.basedOn ?? '-',
    r.fte ?? 1,
    r.hours ?? 0,
    0,
    r.invoiceType,
    r.monthPayment ?? 0,
    r.hourRate ?? 0,
    0,
    r.invoiceTo ?? '',
    r.payType,
    r.fixSalary ?? '',
    0,
    0,
    '',
    r.prepayment ?? '',
    '',
    '',
    null,
    r.fx ?? null,
    r.workHours ?? null,
  ];
}

function sheet(rows: Row[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

export function calcBook(months: Record<string, Row[]>, extra: Record<string, Row[]> = {}): Book {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(months)) {
    XLSX.utils.book_append_sheet(wb, sheet([CALC_HEADER, ...rows]), name);
  }
  for (const [name, rows] of Object.entries(extra))
    XLSX.utils.book_append_sheet(wb, sheet(rows), name);
  return { file: 'calc', sheets: sheetFromWorkbook('calc', wb) };
}

export function benchBook(rows: Row[]): Book {
  const wb = XLSX.utils.book_new();
  const ws = sheet([
    [
      'Name',
      'Position',
      'Seniority',
      'Core Tech Stack',
      'Web3 / Domain Focus',
      'Allocation ',
      'Rate (USD/h)',
      'Availability',
      'Location',
      'CV',
      'Contact Person',
    ],
    ...rows,
  ]);
  // Hyperlink on the first CV cell, as in the real Bench (J2).
  const cv = ws.J2 as XLSX.CellObject | undefined;
  if (cv) cv.l = { Target: 'https://drive.google.com/file/d/abc/view' };
  XLSX.utils.book_append_sheet(wb, ws, 'Bench');
  return { file: 'bench', sheets: sheetFromWorkbook('bench', wb) };
}

export const SOW_SHEET: Row[] = [
  ['Invoice (offer) / Інвойс (оферта) № 22/26'],
  [
    'to the Master Services Agreement №20-08/25 dated 20.08.2025 (Exhibit A STATEMENT OF WORK #1) / до Генеральної угоди',
  ],
  [],
  ['Date and Place: 29.09.2026, Odesa', 'Дата та місце: 29.09.2026, м. Одеса'],
  [
    'Supplier: LLC "SYNTORA"\nCompany address: 17 Polova Street, Fontanka\nRepresented by Vladyslav Boichenko, Director\nCompany number: 46140580',
    null,
    'Постачальник: ТОВ "СІНТОРА", \nАдреса: 67571, Україна, с. Фонтанка\nВ особі директора Бойченко Владислава Сергійовича\nЄДРПОУ: 46140580',
  ],
  [
    'Customer: Creditor Group Corp.\n108 W. 13th Street, Suite 100, Wilmington, DE 19801\nFile number: 6576537',
  ],
  [],
  [],
  [],
  [
    'Customer Bank information:\nBeneficiary: Creditor Group Corp.\nAccount # : -',
    null,
    'Supplier Bank information:\nIBAN code : UA833052990000026004024931648',
  ],
  [],
  [
    '№',
    'Description/\nОпис',
    'Amount, hours/\nКількість, години',
    'Monthly Fee USD /\nЩомісячна оплата',
    'Amount, USD /\nЗагальна вартість',
  ],
  [2, 'Software Development / Розробка - Vladislav', 176, 5500, 5500],
  ['Total to pay/ One thousand one hundred U.S. dollars', null, null, null, 1100],
];

/** No agreement line and a single amount column, like the `Switzerland` sheet. */
export const SWISS_SHEET: Row[] = [
  [],
  ['Invoice (offer) / Інвойс (оферта) № 21/26'],
  [],
  ['Date and Place: 29.09.2026, Odesa'],
  ['Supplier: LLC "SYNTORA"'],
  ['Customer: DPH International GmbH\nZugerstrasse 76B\n6340 Baar'],
  [],
  [],
  [],
  ['Customer Bank information:\nBeneficiary: DPH International GmbH'],
  [],
  ['№', 'Description/\nОпис', 'Amount, USD /\nЗагальна вартість'],
  [1, 'Software Development and Consulting Services', 1000],
  ['Total to pay/ One thousand U.S. dollars 00 cents', null, null, null, 1000],
];

/** A stale sheet whose number is not a real invoice (spec 8.1 lists 21, 22, 24/26 only). */
export const STALE_SOW_SHEET: Row[] = SOW_SHEET.map((row, i) =>
  i === 0 ? ['Invoice (offer) / Інвойс (оферта) № 10/26'] : row,
);

export const ACT_SHEET: Row[] = [
  [],
  [
    'Акт прийому-передачі програмної продукції № OD-1001-А3\nза Договором № OD-1001 від 04.09.2025\n',
  ],
  ['м. Одеса', '02.11.2025 р.'],
  ['ТОВ “СІНТОРА”, далі - Замовник'],
  [
    'ЩУРКО ВІТАЛІЯ РОМАНІВНА, зареєстрована як фізична особа-підприємець в Україні (Номер запису в Єдиному державному реєстрі юридичних осіб, фізичних осіб-підприємців та громадських формувань 2010350000000629450 від 28.08.2024), далі - Виконавець',
  ],
  [
    null,
    null,
    'Виконавець:\nФОП ЩУРКО ВІТАЛІЯ РОМАНІВНА\nІПН: 3589310400\nАдреса: Україна, 82446, Львівська обл.,\nСтрийський р-н\nР/р:\nАТ "УНІВЕРСАЛ БАНК”,\nUA623220010000026005340140170',
  ],
];

/** A miniature `Syntora_Ledger` with the anomalies the importer must handle (A10, A11). */
export function ledgerBook(): Book {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Row[]) => {
    XLSX.utils.book_append_sheet(wb, sheet(rows), name);
  };
  add('Accounts', [
    ['Account ID', 'Account Name', 'Type', 'Currency', 'Network', 'Opening Balance'],
    [1, 'Privat USD', 'Bank', 'USD', null, 3901.78],
    [2, 'Privat EUR', 'Bank', 'EUR', null, 0],
    [3, 'Crypto ETH - USDC', 'Crypto', 'USDC', 'ETH', 959.922092],
  ]);
  add('Categories', [
    ['Type', 'Category'],
    ['Revenue', 'Client Revenue'],
    ['Expense', 'Software / Tools'],
    ['FX Exchange', 'FX Exchange'],
  ]);
  const header = [
    'Date',
    'Type',
    'Category',
    'From Account',
    'To Account',
    'Amount From',
    'Currency From',
    'Amount To',
    'Currency To',
    'FX Rate',
    'Fee Amount',
    'Fee Account',
    'Description',
  ];
  add('Transactions', [
    header,
    [
      46023,
      'Revenue',
      'Client Revenue',
      null,
      'Privat USD',
      null,
      null,
      2000,
      'USD',
      null,
      5,
      'Privat USD',
      'Client pays',
    ],
    [
      46029,
      'Expense',
      'Software / Tools',
      'Crypto ETH - USDC',
      null,
      100,
      'USD',
      null,
      null,
      null,
      null,
      null,
      'Bonus',
    ],
    [
      46038,
      'FX Exchange',
      'FX Exchange',
      'Privat USD',
      'Privat EUR',
      1400.2,
      'USD',
      1400.2 / 1.168,
      'EUR',
      1.168,
    ],
    [],
  ]);
  add('Balances', [
    ['Account Name', 'Type', 'Currency', 'Opening', 'In', 'Out', 'Fees', 'Current Balance'],
    ['Privat USD', 'Bank', 'USD', 3901.78, 0, 0, 0, 4496.58],
    ['Privat EUR', 'Bank', 'EUR', 0, 0, 0, 0, 1198.8013698630139],
    ['Crypto ETH - USDC', 'Crypto', 'USDC', 959.922092, 0, 0, 0, 859.922092],
  ]);
  add('FX_Rates', [
    ['Date', 'Currency', 'Rate to USD'],
    [46057, 'USD', 1],
    [46057, 'EUR', 1.168],
    [46057, 'UAH', 0.02325581395],
  ]);
  return { file: 'ledger', sheets: sheetFromWorkbook('ledger', wb) };
}
