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
    null,
    null,
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
];

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
