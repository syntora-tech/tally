import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { aliasesSchema } from '../src/aliases';
import { parseTrips } from '../src/sources/trips';
import { buildTripsModel } from '../src/trips';
import { sheetFromWorkbook } from '../src/workbook';

type Row = (string | number | null)[];

const pad = (row: Row, width: number) => [...row, ...Array<null>(width - row.length).fill(null)];

/** A `Business_trips` sheet: items on the left, rates, and optionally a card statement at N. */
function tripSheet(title: string, participant: string, rows: Row[], cards: Row[] = []): Row[] {
  const head: Row[] = [
    [
      'Title',
      title,
      null,
      null,
      null,
      null,
      null,
      null,
      'Exchange rates:',
      'USD',
      'EUR',
      'UAH',
      null,
      'Дата i час операції',
    ],
    ['Participant', participant, null, null, null, null, null, null, null, 1, '0,8', '40'],
    ['Service', 'Cost', 'Cost In USD', 'Is compensation required?', 'Currency', 'UAH'],
  ];
  const out = [...head, ...rows].map((r) => pad(r, 20));
  cards.forEach((c, i) => {
    const target = out[i + 1] ?? (out[i + 1] = pad([], 20));
    c.forEach((v, j) => (target[13 + j] = v));
  });
  return out;
}

function book(sheets: Record<string, Row[]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return { file: 'trips', sheets: sheetFromWorkbook('trips', wb) };
}

const cardRows: Row[] = [
  ['21.06.2036\n20:06:57', 'Uber', 'Uber', '400.00грн.', 10, 'EUR', 40],
  ['20.06.2036\n13:00:00', 'Cafe', 'Food', '200.00грн.', 5, 'EUR', 40],
];

const sheets = parseTrips(
  book({
    Conf: tripSheet(
      'Conf 2036',
      'Ann',
      [
        ['Ticket', 100, 100, 'No', 'USD', null],
        ['Hotel', 200, 250, 'No', 'EUR', '10,000.00грн.'],
        ['Food', 15, 18.75, 'Yes', 'EUR', '600.00грн.'],
        ['Empty template', null, 0, 'Yes', 'UAH', null],
      ],
      cardRows,
    ),
    Copy: tripSheet('Copy', 'Ann', [['Ticket', 80, 100, 'Yes', 'EUR', 30384.79]], cardRows),
  }),
);

const aliases = aliasesSchema.parse({
  people: {},
  clients: {},
  payees: {},
  trips: {
    Conf: {
      participant: 'Ann Example',
      startsOn: '2036-06-19',
      endsOn: '2036-06-21',
      cards: true,
      cardReplaces: ['Food'],
      reimbursable: ['Hotel'],
      act: '9 - А1',
    },
    Copy: { participant: 'Ann Example', title: 'Barcelona', ignoreUah: true },
  },
});

describe('Business_trips import (8.1, A-070)', () => {
  const model = buildTripsModel(sheets, aliases);
  const conf = model.trips.find((t) => t.sheet === 'Conf');
  const copy = model.trips.find((t) => t.sheet === 'Copy');

  it('reads items and card rows; card rows replace the summary row they break down', () => {
    expect(conf?.expenses.map((e) => e.description)).toEqual([
      'Ticket',
      'Hotel',
      'Uber',
      'Cafe — Food',
    ]);
    expect(conf?.expenses.find((e) => e.description === 'Uber')).toMatchObject({
      spentOn: '2036-06-21',
      amount: '10',
      currency: 'EUR',
      amountUah: '400.00',
      amountUsd: '12.50000000',
      reimbursable: true,
    });
  });

  it('keeps "No" rows unreimbursed unless configured, and reports the override (A14)', () => {
    expect(conf?.expenses.find((e) => e.description === 'Ticket')?.reimbursable).toBe(false);
    expect(conf?.expenses.find((e) => e.description === 'Hotel')).toMatchObject({
      reimbursable: true,
      amountUah: '10000.00',
      fxRate: '50.000000',
    });
    expect(model.anomalies.some((a) => a.code === 'A14')).toBe(true);
  });

  it('a copied sheet: UAH from its own rate, card rows skipped, reimbursed by the act', () => {
    expect(copy).toMatchObject({ title: 'Barcelona', startsOn: null, reimbursement: null });
    expect(copy?.expenses).toEqual([
      expect.objectContaining({
        description: 'Ticket',
        amountUsd: '100.00000000',
        amountUah: '4000.00',
      }),
    ]);
    expect(conf?.reimbursement).toEqual({ ref: 'trips:Conf:reimbursement', act: '9 - А1' });
    expect(model.anomalies.map((a) => a.message).join('\n')).toMatch(/2 card rows .* skipped/);
  });
});
