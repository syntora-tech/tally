import { describe, expect, it } from 'vitest';
import { buildDossier, type DossierDoc } from './structure';

const doc = (over: Partial<DossierDoc>): DossierDoc => ({
  id: over.id ?? 'd',
  type: 'contract',
  number: null,
  title: over.id ?? 'd',
  docDate: null,
  status: 'issued',
  hasFile: true,
  url: null,
  packageId: null,
  packagePages: null,
  historical: false,
  contractIds: [],
  annexIds: [],
  ...over,
});

const contracts = [{ id: 'c1', kind: 'client', number: 'MSA', status: 'active', signedOn: null }];
const annexes = [
  {
    id: 'a1',
    contractId: 'c1',
    kind: 'sow',
    number: '1',
    title: null,
    status: 'active',
    validFrom: null,
  },
];

describe('buildDossier (A-079)', () => {
  it('files a document under its SOW, else its contract, else without a contract', () => {
    const d = buildDossier(contracts, annexes, [
      doc({ id: 'msa', contractIds: ['c1'] }),
      doc({ id: 'sow', type: 'sow', contractIds: ['c1'], annexIds: ['a1'] }),
      doc({ id: 'nda', type: 'nda' }),
      doc({ id: 'foreign', contractIds: ['other-contract'] }),
    ]);
    expect(d.contracts[0]?.docs.map((x) => x.id)).toEqual(['msa']);
    expect(d.contracts[0]?.annexes[0]?.docs.map((x) => x.id)).toEqual(['sow']);
    expect(d.unfiled.docs.map((x) => x.id)).toEqual(['foreign', 'nda']);
    expect(d.contracts[0]?.total).toBe(2);
  });

  it('groups invoices, bills and acts by month, newest first, undated last', () => {
    const d = buildDossier(contracts, annexes, [
      doc({ id: 'aug', type: 'invoice', docDate: '2026-08-03', contractIds: ['c1'] }),
      doc({ id: 'sep', type: 'act', docDate: '2026-09-30', contractIds: ['c1'] }),
      doc({ id: 'sep2', type: 'bill', docDate: '2026-09-02', contractIds: ['c1'] }),
      doc({ id: 'none', type: 'invoice', contractIds: ['c1'] }),
    ]);
    expect(d.contracts[0]?.months.map((m) => [m.month, m.docs.map((x) => x.id)])).toEqual([
      ['2026-09', ['sep2', 'sep']],
      ['2026-08', ['aug']],
      [null, ['none']],
    ]);
    expect(d.contracts[0]?.docs).toEqual([]);
  });
});
