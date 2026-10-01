import { parseLocalDate } from '@tally/domain';
import { describe, expect, it } from 'vitest';
import { aliasesSchema } from '../src/aliases';
import { buildRegistry } from '../src/registry';
import { actSequence, contractOfActNumber, type RegistryAct } from '../src/sources/acts';

const d = (s: string) => parseLocalDate(s)._unsafeUnwrap();
const act = (
  contractor: string,
  date: string,
  number: string,
  amount: string,
  row: number,
): RegistryAct => ({
  ref: `acts:ФОПы акты:R${String(row)}`,
  contractor,
  actDate: d(date),
  number,
  amountUah: amount,
});

describe('acts registry (spec 8.1, A8, A9)', () => {
  it('derives contract numbers and sequences from act numbers', () => {
    expect(contractOfActNumber('1003  -А4')).toBe('OD-1003');
    expect(contractOfActNumber('1001 - A12')).toBe('OD-1001');
    expect(contractOfActNumber('MF281025/7')).toBe('MF281025');
    expect(actSequence(['1003 - А2', '1003  -А4', '1003 - А10'])).toEqual({
      template: '1003 - А{seq}',
      nextValue: 11,
    });
  });

  const registry = buildRegistry(
    [
      act('ДОЛІНА МАКСИМ ВІКТОРОВИЧ', '2026-01-30', '1003 - А2', '86011.60', 22),
      act('ДОЛІНА МАКСИМ ВІКТОРОВИЧ', '2026-02-28', '1003 - А3', '86759', 23),
      act('ДОЛІНА МАКСИМ ВІКТОРОВИЧ', '2026-03-31', '1003  -А4', '95832.45', 24),
      act('ДОЛІНА МАКСИМ ВІКТОРОВИЧ', '2026-05-29', '1003 - А5', '88900.20', 25),
      act('ХОМИН ЛЮБОВ ІВАНІВНА', '2026-02-12', 'MF281025/3', '30546.50', 2),
    ],
    { payees: [], contracts: [] },
    aliasesSchema.parse({
      people: {},
      clients: {},
      payees: {},
      actContractors: { 'ДОЛІНА МАКСИМ ВІКТОРОВИЧ': { person: 'dolina-maksym' } },
    }),
  );

  it('creates missing FOP payees and contracts, linking Dolina to her person', () => {
    expect(registry.payees.map((p) => p.legalNameUa)).toEqual([
      'ФОП ДОЛІНА МАКСИМ ВІКТОРОВИЧ',
      'ФОП ХОМИН ЛЮБОВ ІВАНІВНА',
    ]);
    expect(registry.defaultPayees).toEqual([
      { personKey: 'dolina-maksym', payeeKey: 'registry-dolina-maksym-viktorovych' },
    ]);
    expect(registry.contracts.map((c) => [c.number, c.actDateRule?.type ?? null])).toEqual([
      ['OD-1003', null],
      ['MF281025', 'manual'],
    ]);
  });

  it('keeps numbers verbatim and maps early-month dates to the previous month (Q7)', () => {
    expect(registry.acts.find((a) => a.number === '1003  -А4')?.periodFrom).toBe('2026-03-01');
    expect(registry.acts.find((a) => a.number === 'MF281025/3')).toMatchObject({
      periodFrom: '2026-01-01',
      periodTo: '2026-01-31',
    });
  });

  it('reports Saturday dates (A8) and the missing April (A9)', () => {
    const codes = registry.anomalies.map((a) => `${a.code}:${a.message.slice(0, 40)}`);
    expect(codes.filter((c) => c.startsWith('act_weekend_date'))).toHaveLength(1);
    expect(registry.anomalies.find((a) => a.code === 'act_missing_month')?.message).toContain(
      '2026-04',
    );
    expect(registry.sequences).toContainEqual({
      key: 'act:OD-1003',
      template: '1003 - А{seq}',
      nextValue: 6,
    });
  });
});
