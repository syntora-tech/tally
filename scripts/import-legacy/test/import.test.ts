import { describe, expect, it } from 'vitest';
import { aliasesSchema, draftAliases, type Aliases } from '../src/aliases';
import { decimal, uaDateIn } from '../src/cells';
import { buildModel } from '../src/model';
import { renderReport } from '../src/report';
import { parseBench, splitLocation } from '../src/sources/bench';
import { parseCalc } from '../src/sources/calc';
import { parseHeaders } from '../src/sources/headers';
import { same } from '../src/writer';
import { ACT_SHEET, benchBook, calcBook, calcRow, SOW_SHEET } from './fixtures';

describe('cells', () => {
  it('keeps money as decimal strings', () => {
    expect(decimal(43.99)).toBe('43.99');
    expect(decimal(5500)).toBe('5500');
    expect(decimal('0,86')).toBe('0.86');
    expect(decimal(' 1 400.2 ')).toBe('1400.2');
    expect(decimal('–')).toBeNull();
    expect(decimal('crypto')).toBeNull();
  });

  it('finds dates inside text', () => {
    expect(uaDateIn('From 01.09.2026')).toBe('2026-09-01');
    expect(uaDateIn('Available')).toBeNull();
  });

  it('splits location and timezone', () => {
    expect(splitLocation('Canada, London ON, UTC-4')).toEqual({
      location: 'Canada, London ON',
      timezone: 'UTC-4',
    });
    expect(splitLocation('Portugal, UTC +1')).toEqual({ location: 'Portugal', timezone: 'UTC+1' });
    expect(splitLocation('Bucharest, Romania')).toEqual({
      location: 'Bucharest, Romania',
      timezone: null,
    });
  });
});

describe('parsers', () => {
  it('parses Bench rows with CV hyperlinks and availability', () => {
    const book = benchBook([
      [
        'Andrii H.',
        'DevOps Engineer',
        'Lead, Senior',
        'AWS, Kubernetes',
        'DevOps / SRE',
        'Part Time',
        60,
        'Available',
        'Ukraine, UTC+3',
        'CV Andrii.pdf',
        '@alina',
      ],
      [
        'Vlad P.',
        'DevOps Engineer',
        'Middle',
        'AWS',
        '',
        'Full Time',
        40,
        'From 01.08.2026',
        'Ukraine, UTC+3',
        'CV is being updated',
        '@alina',
      ],
    ]);
    const { rows, problems } = parseBench(
      book.sheets.get('Bench') ?? { file: '', name: '', hidden: false, rows: [] },
    );
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({
      name: 'Andrii H.',
      seniority: ['Lead', 'Senior'],
      allocation: 'part_time',
      marketRateUsd: '60',
      availabilityFrom: null,
      cv: { title: 'CV Andrii.pdf', url: 'https://drive.google.com/file/d/abc/view' },
    });
    expect(rows[1]).toMatchObject({
      allocation: 'full_time',
      availabilityFrom: '2026-08-01',
      cv: null,
    });
  });

  it('parses invoice and act headers', () => {
    const { invoices, acts } = parseHeaders(
      calcBook({}, { 'SOW #1': SOW_SHEET, 'Акт Щурко': ACT_SHEET }),
    );
    expect(invoices[0]).toMatchObject({
      contractNumber: '20-08/25',
      contractDate: '2025-08-20',
      sowRef: 'SOW #1',
      customer: { legalName: 'Creditor Group Corp.' },
      supplier: { nameEn: 'LLC "SYNTORA"', nameUa: 'ТОВ "СІНТОРА"', legalCode: '46140580' },
    });
    expect(acts[0]).toMatchObject({
      contractNumber: 'OD-1001',
      contractDate: '2025-09-04',
      legalNameUa: 'ФОП ЩУРКО ВІТАЛІЯ РОМАНІВНА',
      taxId: '3589310400',
      iban: 'UA623220010000026005340140170',
      edrRecord: '2010350000000629450',
      edrDate: '2024-08-28',
    });
  });
});

const boostySow = { basedOn: 'EXHIBIT A\nSTATEMENT OF WORK #5' };
const months = {
  June: [
    calcRow({
      employee: 'Dolina Maksym',
      partner: 'Syntora.Tech',
      role: 'CEO',
      invoiceType: 'Skip',
      payType: 'Fix',
      fixSalary: 2020,
      prepayment: 'Fiat',
    }),
    calcRow({
      employee: 'Vlad Sklyarov',
      partner: 'Boosty',
      role: 'Senior Java Developer',
      ...boostySow,
      invoiceType: 'Hours',
      monthPayment: 45,
      payType: 'Hours',
      fixSalary: 7040,
      prepayment: 'Crypto',
    }),
    calcRow({
      employee: 'Vladyslav',
      partner: 'Trady',
      role: 'Full-stack developer',
      invoiceType: 'Fix',
      monthPayment: 5500,
      invoiceTo: 'crypto',
      payType: 'Hours',
      fixSalary: 5000,
      prepayment: 'Crypto',
    }),
    calcRow({
      employee: 'qOne',
      partner: 'Boosty',
      role: 'Team',
      fte: 3,
      invoiceType: 'Fix',
      monthPayment: 5500,
      payType: '',
    }),
  ],
  July: [
    calcRow({
      employee: 'Dolina Maksym',
      partner: 'Syntora.Tech',
      role: 'CEO',
      invoiceType: 'Skip',
      payType: 'Fix',
      fixSalary: 2020,
      prepayment: 'Fiat',
    }),
    calcRow({
      employee: ' Vlad Sklyarov ',
      partner: 'Boosty',
      role: 'Senior Java Developer',
      ...boostySow,
      invoiceType: 'Hours',
      monthPayment: 45,
      payType: 'Hours',
      fixSalary: 7360,
      prepayment: 'Crypto',
    }),
    calcRow({
      employee: 'Vladyslav',
      partner: 'Trady',
      role: 'Full-stack developer',
      invoiceType: 'Fix',
      monthPayment: 5500,
      invoiceTo: 'crypto',
      payType: 'Hours',
      fixSalary: 5000,
    }),
    calcRow({
      employee: 'Services ',
      partner: 'Red Jumpers',
      role: '',
      invoiceType: 'Skip',
      payType: 'Fix',
    }),
  ],
  'Копія аркуша Current': [
    calcRow({
      employee: 'Dolina Maksym',
      partner: 'Syntora.Tech',
      role: 'CEO',
      invoiceType: 'Skip',
      payType: 'Fix',
      fixSalary: 2020,
    }),
    calcRow({
      employee: 'Vlad Sklyarov',
      partner: 'Boosty',
      role: 'Senior Java Developer',
      ...boostySow,
      invoiceType: 'Hours',
      monthPayment: 4000,
      payType: 'Hours',
      fixSalary: 7360,
    }),
  ],
  Current: [
    calcRow({
      employee: 'Dolina Maksym',
      partner: 'Syntora.Tech',
      role: 'CEO',
      invoiceType: 'Skip',
      payType: 'Fix',
      fixSalary: 1020,
    }),
    calcRow({
      employee: 'Vlad Sklyarov',
      partner: 'Boosty',
      role: 'Senior Java Developer',
      ...boostySow,
      invoiceType: 'Hours',
      monthPayment: 45,
      payType: 'Hours',
      fixSalary: 7040,
    }),
  ],
};

function sources() {
  const book = calcBook(months, {
    'SOW #5': SOW_SHEET.map((r, i) =>
      i === 1
        ? [
            'to the Master Services Agreement №20-08/25 dated 20.08.2025 (Exhibit A STATEMENT OF WORK #5)',
          ]
        : r,
    ),
    'Акт Щурко': ACT_SHEET,
  });
  const calc = parseCalc(book);
  const { invoices, acts } = parseHeaders(book);
  return { calc, src: { bench: [], calc: calc.rows, invoices, acts } };
}

const aliases: Aliases = aliasesSchema.parse({
  people: {
    dolina: { fullName: 'Доліна Максим', names: ['Dolina Maksym'] },
    sklyarov: { fullName: 'Vlad Sklyarov', names: ['Vlad Sklyarov'] },
    vladyslav: { fullName: 'Vladyslav Boichenko', names: ['Vladyslav'] },
  },
  clients: {
    creditor: {
      legalName: 'Creditor Group Corp.',
      shortName: 'Boosty',
      partnerNames: ['Boosty'],
      invoiceSheets: ['SOW #5'],
    },
    trady: { legalName: 'Trady', partnerNames: ['Trady'] },
  },
  payees: { shchurko: { actSheet: 'Акт Щурко' } },
  skipEmployees: ['qOne'],
  prorationOverrides: [{ client: 'trady', policy: 'full_month' }],
});

describe('buildModel', () => {
  it('reports missing sheets for months not present', () => {
    expect(sources().calc.problems.some((p) => p.includes('January'))).toBe(true);
  });

  it('creates assignments per person × client × role with term versions on changes only', () => {
    const model = buildModel(sources().src, aliases);
    const sklyarov = model.assignments.find((a) => a.personKey === 'sklyarov');
    expect(sklyarov).toMatchObject({
      clientKey: 'creditor',
      contractRef: 'contract:client:creditor:20-08-25',
      sowRef: 'SOW #5',
      startsOn: '2026-06-01',
      endsOn: null,
    });
    const pay = model.pay
      .filter((p) => p.assignmentRef === sklyarov?.ref)
      .map((p) => [p.validFrom, p.amount]);
    expect(pay).toEqual([
      ['2026-06-01', '7040'],
      ['2026-07-01', '7360'],
      ['2026-09-01', '7040'],
    ]);
    const billing = model.billing.filter((b) => b.assignmentRef === sklyarov?.ref);
    expect(billing.map((b) => [b.validFrom, b.type, b.rate])).toEqual([
      ['2026-06-01', 'hourly', '45'],
    ]);
  });

  it('flags the 4 000 $/h row instead of importing it', () => {
    const model = buildModel(sources().src, aliases);
    expect(model.anomalies.find((a) => a.code === 'suspicious_rate')?.ref).toBe(
      'calc:Копія аркуша Current:R3',
    );
  });

  it('applies proration overrides (A2) and ends assignments missing from Current', () => {
    const model = buildModel(sources().src, aliases);
    const trady = model.assignments.find((a) => a.clientKey === 'trady');
    expect(trady?.endsOn).toBe('2026-07-31');
    expect(model.billing.find((b) => b.assignmentRef === trady?.ref)).toMatchObject({
      type: 'fixed_monthly',
      prorationPolicy: 'full_month',
      invoiceChannel: 'crypto',
    });
    expect(
      model.anomalies.some((a) => a.code === 'no_contract' && a.message.includes('trady')),
    ).toBe(true);
  });

  it('models internal work, expenses (A5) and non-person rows', () => {
    const model = buildModel(sources().src, aliases);
    const ceo = model.assignments.find((a) => a.personKey === 'dolina');
    expect(ceo).toMatchObject({ isInternal: true, contractRef: null });
    expect(model.pay.filter((p) => p.assignmentRef === ceo?.ref).map((p) => p.amount)).toEqual([
      '2020',
      '1020',
    ]);
    expect(model.anomalies.map((a) => a.code)).toEqual(
      expect.arrayContaining(['A5', 'not_a_person']),
    );
    expect(model.unmapped).toEqual({ people: [], partners: [], actSheets: [], invoiceSheets: [] });
  });

  it('builds payees, FOP contracts and the company from headers', () => {
    const model = buildModel(sources().src, aliases);
    expect(model.payees[0]).toMatchObject({
      key: 'shchurko',
      legalNameUa: 'ФОП ЩУРКО ВІТАЛІЯ РОМАНІВНА',
    });
    expect(model.contracts.find((c) => c.kind === 'fop')).toMatchObject({
      number: 'OD-1001',
      currency: 'UAH',
    });
    expect(model.company).toMatchObject({ nameEn: 'LLC "SYNTORA"', legalCode: '46140580' });
  });

  it('lists unmapped names without guessing', () => {
    const model = buildModel(sources().src, { ...aliases, people: {} });
    expect(model.unmapped.people).toEqual(['Dolina Maksym', 'Vlad Sklyarov', 'Vladyslav']);
    const report = renderReport({
      model,
      stats: null,
      dryRun: true,
      problems: [],
      generatedAt: 'now',
    });
    expect(report).toContain('«Vlad Sklyarov»');
  });
});

describe('draftAliases', () => {
  it('merges calc spellings into Bench names, links clients via SOW and skips teams', () => {
    const { src } = sources();
    const bench = parseBench(
      benchBook([
        ['Vlad S.', 'Java', 'Senior', 'Java', '', 'Full Time', 45, 'Available', 'Romania', '', ''],
      ]).sheets.get('Bench') ?? { file: '', name: '', hidden: false, rows: [] },
    ).rows;
    const draft = draftAliases({ ...src, bench });
    expect(draft.people['vlad-s']?.names).toEqual(['Vlad S.', 'Vlad Sklyarov']);
    expect(Object.values(draft.people).some((p) => p.names.includes('qOne'))).toBe(false);
    expect(draft.clients['creditor-group-corp']).toMatchObject({
      shortName: 'Boosty',
      invoiceSheets: ['SOW #5'],
    });
    expect(draft.prorationOverrides).toContainEqual({ client: 'trady', policy: 'full_month' });
  });
});

describe('same (re-import comparison)', () => {
  it('compares decimals by value and ignores null/undefined differences', () => {
    expect(same('5500.00000000', '5500')).toBe(true);
    expect(same('5500.00000000', '5501')).toBe(false);
    expect(same(null, undefined)).toBe(true);
    expect(same(['AWS'], ['AWS'])).toBe(true);
    expect(same('OD-1001', 'OD-1001')).toBe(true);
  });
});
