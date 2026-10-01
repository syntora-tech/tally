import { localDate, type LocalDate } from '@tally/domain';
import { decimal, text, uaDateIn } from '../cells';
import { cellAt, ref, type Book, type Sheet } from '../workbook';

/**
 * Month of each calculation sheet (spec 8.1): January…July by name, the copy of `Current` is
 * August and `Current` is September 2026.
 */
export const MONTH_SHEETS: Record<string, LocalDate> = {
  January: localDate(2026, 1, 1),
  February: localDate(2026, 2, 1),
  March: localDate(2026, 3, 1),
  April: localDate(2026, 4, 1),
  May: localDate(2026, 5, 1),
  June: localDate(2026, 6, 1),
  July: localDate(2026, 7, 1),
  'Копія аркуша Current': localDate(2026, 8, 1),
  Current: localDate(2026, 9, 1),
};

export type CalcRow = {
  ref: string;
  month: LocalDate;
  employee: string;
  partner: string;
  role: string;
  basedOn: string;
  fte: string | null;
  hours: string | null;
  invoiceType: string;
  monthPayment: string | null;
  hourRate: string | null;
  invoiceTo: string;
  payType: string;
  fixSalary: string | null;
  prepayment: string;
  workPeriod: string;
  exchangeRate: string | null;
  workHoursInMonth: string | null;
  /** O: salary in USD as the sheet computed it. */
  currentPayment: string | null;
  /** P: what was actually paid in UAH (hides manual corrections, A4). */
  uahPaid: string | null;
  /** S: Vchasno / Tronscan link of the payout. */
  payoutLink: string | null;
  /** T: "yes" when paid. */
  paid: boolean;
};

export type CalcParse = { rows: CalcRow[]; problems: string[] };

const COL = {
  employee: 0,
  partner: 1,
  role: 2,
  basedOn: 3,
  fte: 4,
  hours: 5,
  invoiceType: 7,
  monthPayment: 8,
  hourRate: 9,
  invoiceTo: 11,
  payType: 12,
  fixSalary: 13,
  currentPayment: 14,
  uahPaid: 15,
  workPeriod: 16,
  prepayment: 17,
  payoutLink: 18,
  paid: 19,
  exchangeRate: 21,
  workHours: 22,
} as const;

function parseSheet(sheet: Sheet, month: LocalDate, problems: string[]): CalcRow[] {
  const header = text(cellAt(sheet, 0, COL.employee).v).toLowerCase();
  if (header !== 'employee') {
    problems.push(`${sheet.name}: перший стовпець має бути «Employee»`);
    return [];
  }
  // Month-level values live in the first data row (Курс 1USD, Work Hours in Month).
  const exchangeRate = decimal(cellAt(sheet, 1, COL.exchangeRate).v);
  const workHoursInMonth = decimal(cellAt(sheet, 1, COL.workHours).v);
  const rows: CalcRow[] = [];
  for (let r = 1; r < sheet.rows.length; r++) {
    const at = (c: number) => cellAt(sheet, r, c);
    const employee = text(at(COL.employee).v);
    const partner = text(at(COL.partner).v);
    // Totals row (A1) and blank rows carry no employee/partner: totals are recomputed, never imported.
    if (!employee && !partner) continue;
    const workPeriod = text(at(COL.workPeriod).v);
    const periodStart = uaDateIn(workPeriod);
    if (periodStart && periodStart.slice(0, 7) !== month.slice(0, 7)) {
      problems.push(
        `${ref(sheet, r)}: період «${workPeriod}» не збігається з місяцем аркуша ${month.slice(0, 7)}`,
      );
    }
    rows.push({
      ref: ref(sheet, r),
      month,
      employee,
      partner,
      role: text(at(COL.role).v),
      basedOn: text(at(COL.basedOn).v),
      fte: decimal(at(COL.fte).v),
      hours: decimal(at(COL.hours).v),
      invoiceType: text(at(COL.invoiceType).v),
      monthPayment: decimal(at(COL.monthPayment).v),
      hourRate: decimal(at(COL.hourRate).v),
      invoiceTo: text(at(COL.invoiceTo).v),
      payType: text(at(COL.payType).v),
      fixSalary: decimal(at(COL.fixSalary).v),
      prepayment: text(at(COL.prepayment).v),
      workPeriod,
      exchangeRate,
      workHoursInMonth,
      currentPayment: decimal(at(COL.currentPayment).v),
      uahPaid: decimal(at(COL.uahPaid).v),
      payoutLink:
        at(COL.payoutLink).link ??
        (/^https?:\/\//.test(text(at(COL.payoutLink).v)) ? text(at(COL.payoutLink).v) : null),
      paid: text(at(COL.paid).v).toLowerCase() === 'yes',
    });
  }
  return rows;
}

export function parseCalc(book: Book): CalcParse {
  const problems: string[] = [];
  const rows: CalcRow[] = [];
  for (const [name, month] of Object.entries(MONTH_SHEETS)) {
    const sheet = book.sheets.get(name);
    if (!sheet) {
      problems.push(`Немає аркуша «${name}» (${month.slice(0, 7)})`);
      continue;
    }
    rows.push(...parseSheet(sheet, month, problems));
  }
  return { rows, problems };
}
