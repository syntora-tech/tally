import { describe, expect, it } from 'vitest';
import { actsRegistrySheet, groupRegistry, missingMonths, type RegistryAct } from './registry';

const act = (over: Partial<RegistryAct>): RegistryAct => ({
  id: crypto.randomUUID(),
  number: null,
  actDate: '2026-01-31',
  amountUah: '0',
  status: 'issued',
  type: 'monthly',
  periodFrom: null,
  periodTo: null,
  isLegacy: false,
  signed: false,
  contractId: 'c',
  contractNumber: '1001',
  ...over,
});

describe('supplier acts registry', () => {
  it('flags months without a monthly act between the first and the last one', () => {
    expect(
      missingMonths([
        act({ actDate: '2026-01-30' }),
        act({ actDate: '2026-04-30' }),
        act({ actDate: '2026-02-27', status: 'void' }),
        act({ actDate: '2026-03-10', type: 'reimbursement' }),
      ]),
    ).toEqual(['2026-02', '2026-03']);
    expect(missingMonths([act({ actDate: '2026-05-29', periodFrom: '2026-05-01' })])).toEqual([]);
  });

  it('totals issued acts per counterparty and overall', () => {
    const rows = [
      { payeeId: 'a', payeeName: 'ДОЛІНА', ...act({ amountUah: '86011.60' }) },
      {
        payeeId: 'a',
        payeeName: 'ДОЛІНА',
        ...act({ actDate: '2026-02-27', amountUah: '86759.00' }),
      },
      { payeeId: 'a', payeeName: 'ДОЛІНА', ...act({ status: 'draft', amountUah: '5' }) },
      { payeeId: 'b', payeeName: 'ЩУРКО', ...act({ amountUah: '97934.00' }) },
      { payeeId: 'b', payeeName: 'ЩУРКО', ...act({ status: 'void', amountUah: '7' }) },
    ];
    const registry = groupRegistry(rows);
    expect(registry.groups.map((g) => [g.payeeName, g.acts.length, g.total])).toEqual([
      ['ДОЛІНА', 3, '172770.60'],
      ['ЩУРКО', 2, '97934.00'],
    ]);
    expect(registry).toMatchObject({ total: '270704.60', count: 3 });
  });

  it('lays the sheet out like the accountant registry', () => {
    const { groups } = groupRegistry([
      { payeeId: 'a', payeeName: 'ХОМИН', ...act({ number: 'MF/3', amountUah: '30546.50' }) },
      { payeeId: 'a', payeeName: 'ХОМИН', ...act({ number: 'MF/4', amountUah: '29064.00' }) },
      { payeeId: 'a', payeeName: 'ХОМИН', ...act({ status: 'draft', amountUah: '1' }) },
      { payeeId: 'b', payeeName: 'ЩУРКО', ...act({ number: '1001 - А5', amountUah: '97934.00' }) },
    ]);
    const { rows } = actsRegistrySheet(groups);
    expect(rows[0]?.map((c) => (c && 's' in c ? c.s : null))).toEqual([
      'Контрагент',
      'Дата акта',
      'Номер акта',
      'Сума акта',
    ]);
    expect(rows[1]).toEqual([
      { s: 'ХОМИН' },
      { date: '2026-01-31' },
      { s: 'MF/3' },
      { n: '30546.50' },
    ]);
    expect(rows[3]?.[3]).toEqual({ n: '59610.50', bold: true, formula: 'SUM(D2:D3)' });
    expect(rows[4]).toEqual([]);
    expect(rows[6]?.[3]).toEqual({ n: '97934.00', bold: true, formula: 'SUM(D6:D6)' });
    expect(rows[8]?.[3]).toEqual({ n: '157544.50', bold: true, formula: 'D4+D7' });
  });
});
