import { describe, expect, it } from 'vitest';
import { parseCsvTable } from './csv';
import type { LocalDate } from './local-date';
import {
  accountTail,
  pairStatementRows,
  parseBankAmount,
  paymentFeeHints,
  parseBankDate,
  parseStatementTable,
  ruleCategory,
  statementExternalRef,
  type PairingRow,
  type StatementRow,
} from './statement';

// Synthetic statement in the Privat24 business layout: a title line, then the header.
const UAH_CSV = [
  'Виписка по рахунку UA000000000000000000000005293 за 01.10.2026 - 19.10.2026',
  '"ЄДРПОУ";"Рахунок";"Валюта";"Дата операції";"Референс";"Номер документа";"Дебет";"Кредит";"Призначення платежу";"Кореспондент";"ЄДРПОУ кореспондента";"Рахунок кореспондента"',
  '"10000000";"UA000000000000000000000005293";"UAH";"02.10.2026 10:15";"";"126";"45 624,60";"";"ОПЛАТА ЗА ПОСЛУГИ ЗГIДНО ДОГОВОРУ № OD-1003, Без ПДВ.";"ДОЛIНА МАКСИМ ВIКТОРОВИЧ";"1234567890";"UA111"',
  '"10000000";"UA000000000000000000000005293";"UAH";"02.10.2026";"";"127";"5,00";"";"Комiсiя за платiж № 126";"АТ КБ ""ПРИВАТБАНК""";"14360570";""',
  '"10000000";"UA000000000000000000000005293";"UAH";"02.10.2026";"Q1002D3NIA";"";"";"143 136,00";"Гривнi вiд продажу 3200.00 USD по курсу 44.73";"АТ КБ ""ПРИВАТБАНК""";"14360570";""',
  '"10000000";"UA000000000000000000000005293";"UAH";"02.10.2026";"Q1002D3NIB";"";"286,93";"";"Комiсiя банку за продаж 3200.00 USD";"АТ КБ ""ПРИВАТБАНК""";"14360570";""',
  '"10000000";"UA000000000000000000000005293";"UAH";"07.10.2026";"";"129";"282,00";"";"Вiйськовий збiр вiд заробiтної плати за вересень";"ГОЛОВНЕ УДКСУ В ОДЕСЬКIЙ ОБЛАСТI";"37607526";"UA222"',
  '"";"";"";"";"";"";"46 198,53";"143 136,00";"Разом";"";"";""',
].join('\r\n');

const USD_CSV = [
  'ЄДРПОУ;Рахунок;Валюта;Дата операції;Референс;Номер документа;Дебет;Кредит;Призначення платежу;Кореспондент',
  '10000000;UA000000000000000000000001648;USD;02.10.2026;Q1002D3NGN;;3200.00;;Продаж 3200.00 USD по курсу 44.73 (RIDSQ10029NOE3);АТ КБ "ПРИВАТБАНК"',
  '10000000;UA000000000000000000000001648;USD;13.10.2026;;1;;7896.00;From GlobalSoft OU EE Tallinn for No 25/26-2;GlobalSoft OU',
].join('\n');

const parse = (csv: string) => parseStatementTable(parseCsvTable(csv))._unsafeUnwrap();

describe('parseBankAmount', () => {
  it.each([
    ['45 624,60', '45624.6'],
    ['1,234.56', '1234.56'],
    ['-1234.56', '-1234.56'],
    ['+12', '12'],
    ['5,00', '5'],
    ['(10.00)', '-10'],
    ['1.234.567,89', '1234567.89'],
    ['143 136,00', '143136'],
  ])('%s → %s', (raw, expected) => {
    expect(parseBankAmount(raw)?.toFixed()).toBe(expected);
  });

  it.each(['', 'abc', '12-3', '1e5'])('rejects %j', (raw) => {
    expect(parseBankAmount(raw)).toBeNull();
  });
});

describe('parseBankDate', () => {
  it.each([
    ['02.10.2026', '2026-10-02'],
    ['2.10.2026 10:15', '2026-10-02'],
    ['2026-10-02', '2026-10-02'],
    ['02/10/2026', '2026-10-02'],
    ['46297', '2026-10-02'],
  ])('%s → %s', (raw, expected) => {
    expect(parseBankDate(raw)).toBe(expected);
  });

  it('rejects impossible dates', () => {
    expect(parseBankDate('31.02.2026')).toBeNull();
    expect(parseBankDate('Разом')).toBeNull();
  });
});

describe('parseStatementTable', () => {
  it('finds the header below title lines and reads debit/credit rows', () => {
    const s = parse(UAH_CSV);
    expect(s.rows).toHaveLength(5);
    expect(s.skipped).toBe(1); // the totals line
    expect(s.ourAccount).toBe('UA000000000000000000000005293');
    expect(s.currency).toBe('UAH');
    expect(s.columns.purpose).toBe('Призначення платежу');
    expect(s.rows[0]).toMatchObject({
      line: 3,
      occurredOn: '2026-10-02',
      direction: 'out',
      amount: '45624.6',
      docNumber: '126',
      counterpartyTaxId: '1234567890',
      counterparty: 'ДОЛIНА МАКСИМ ВIКТОРОВИЧ',
    });
    expect(s.rows[2]).toMatchObject({ direction: 'in', amount: '143136', ref: 'Q1002D3NIA' });
  });

  it('keeps our account apart from the counterparty account column', () => {
    const s = parse(UAH_CSV);
    expect(s.rows[0]?.counterpartyAccount).toBe('UA111');
    expect(s.rows[0]?.ourAccount).toBe('UA000000000000000000000005293');
  });

  it('reads a signed amount column', () => {
    const s = parse(
      'Дата;Сума;Призначення\n01.10.2026;-10,50;fee\n02.10.2026;20;in\n03.10.2026;0;zero',
    );
    expect(s.rows.map((r) => [r.direction, r.amount])).toEqual([
      ['out', '10.5'],
      ['in', '20'],
    ]);
    expect(s.skipped).toBe(1);
  });

  it('reports a file it cannot read with its headers', () => {
    const result = parseStatementTable(parseCsvTable('a;b;c\n1;2;3'));
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'unknown_format', headers: ['a', 'b', 'c'] });
    expect(parseStatementTable([])._unsafeUnwrapErr()).toEqual({ code: 'empty' });
  });

  it('refuses a file with rows of two accounts', () => {
    const csv = 'Рахунок;Дата;Сума\nUA1;01.10.2026;1\nUA2;01.10.2026;2';
    expect(parseStatementTable(parseCsvTable(csv))._unsafeUnwrapErr()).toEqual({
      code: 'mixed_accounts',
      accounts: ['UA1', 'UA2'],
    });
  });

  it('flags a row with money but an unreadable date', () => {
    const s = parse('Дата;Сума\n2026/10/40;5\n01.10.2026;1');
    expect(s.rows).toHaveLength(1);
    expect(s.problems).toEqual([{ line: 2, field: 'date', value: '2026/10/40' }]);
  });
});

describe('statementExternalRef', () => {
  it('uses the bank reference when there is one', () => {
    const row = parse(UAH_CSV).rows[2];
    expect(row && statementExternalRef(row, '5293')).toBe('privat:Q1002D3NIA');
  });

  it('matches the format agents used without a reference', () => {
    const row = parse(UAH_CSV).rows[0];
    expect(row && statementExternalRef(row, accountTail('UA000000000000000000000005293'))).toBe(
      'privat:5293:2026-10-02:126:45624.60',
    );
  });
});

describe('ruleCategory', () => {
  it.each([
    ['out', 'ГОЛОВНЕ УДКСУ В ОДЕСЬКIЙ ОБЛАСТI', 'Вiйськовий збiр', 'Taxes'],
    ['out', 'ГОЛОВНЕ УПРАВЛIННЯ ДПС', 'ЄСВ вiд заробiтної плати', 'Taxes'],
    ['out', 'АТ КБ "ПРИВАТБАНК"', 'Комiсiя за обслуговування рахунку', 'Bank Fees'],
    [
      'out',
      'ЗА ДЕБЕТУВАННЯ РАХУНКУ(UAH)',
      'Комiсiя за виконання платежiв в нацiональнiй валютi у сумi 15.00 грн, без ПДВ.',
      'Bank Fees',
    ],
    [
      'out',
      'Цiл-вi зарах.ТОВ',
      'Заробiтна плата за першу половину жовтня 2026 р. Без ПДВ.',
      'Payroll',
    ],
    [
      'out',
      'ТОВ Бухгалтер',
      'Бухгалтерськi послуги згiдно договору. Без ПДВ.',
      'Legal / Accounting',
    ],
    ['out', 'ОДВ, ГУДКСУ', 'КБК 14060100 Сплата ПДВ з послуг нерезидента', 'Taxes'],
    ['out', 'ГОЛОВНЕ УДКСУ', 'ПДФО вiд заробiтної плати за жовтень', 'Taxes'],
    ['out', 'Vladyslav', 'Заробiтна плата за другу половину вересня', 'Payroll'],
    ['out', 'Семiроз ФОП', 'Бухгалтерськi послуги згiдно дог.№4', 'Legal / Accounting'],
    ['in', 'GlobalSoft OU', 'From GlobalSoft OU EE Tallinn for No 24/26', 'Client Revenue'],
    ['in', 'ПРИВАТБАНК', 'Нарахування вiдсоткiв на залишок', 'Interest / Other Income'],
    [
      'in',
      'Creditor Group Corp',
      'INTERNATIONAL WIRE TO SYNTORA - INVOICES 26/26',
      'Client Revenue',
    ],
    ['in', 'Bank', 'Interest on balance', 'Interest / Other Income'],
    ['out', 'Bank', 'SWIFT commission for payment', 'Bank Fees'],
  ] as const)('%s %s → %s', (direction, counterparty, purpose, category) => {
    expect(ruleCategory({ direction, counterparty, purpose })?.category).toBe(category);
  });

  it('suggests nothing for an unknown payment', () => {
    expect(
      ruleCategory({ direction: 'out', counterparty: 'ТОВ Ромашка', purpose: 'Оплата' }),
    ).toBeNull();
  });
});

describe('pairStatementRows', () => {
  const uah = parse(UAH_CSV).rows;
  const usd = parse(USD_CSV).rows;
  const rows: PairingRow[] = [
    ...uah.map((r) => ({ ...r, key: `u${String(r.line)}`, accountId: 'uah', currency: 'UAH' })),
    ...usd.map((r) => ({ ...r, key: `d${String(r.line)}`, accountId: 'usd', currency: 'USD' })),
  ];
  const pairing = pairStatementRows(rows);

  it('joins both legs of a currency sale across statements', () => {
    expect(pairing.counterOf.get('u5')).toBe('d2');
    expect(pairing.counterOf.size).toBe(1);
  });

  it('attaches fees by the document number or the amount they name', () => {
    expect(pairing.feeOf.get('u4')).toBe('u3');
    expect(pairing.feeOf.get('u6')).toBe('d2');
  });

  it('leaves the client payment and taxes alone', () => {
    expect(pairing.counterOf.has('d3')).toBe(false);
    expect(pairing.feeOf.has('u7')).toBe(false);
  });

  it('pairs a same-currency transfer only between our own accounts', () => {
    const base = {
      currency: 'UAH',
      occurredOn: '2026-10-05' as LocalDate,
      amount: '100',
      ref: null,
      docNumber: null,
      purpose: 'Переказ',
    };
    const pair = pairStatementRows([
      {
        ...base,
        key: 'a',
        accountId: 'A',
        direction: 'out',
        counterpartyAccount: 'UA-B',
        ourAccount: 'UA-A',
      },
      {
        ...base,
        key: 'b',
        accountId: 'B',
        direction: 'in',
        counterpartyAccount: 'UA-A',
        ourAccount: 'UA-B',
      },
      {
        ...base,
        key: 'c',
        accountId: 'C',
        direction: 'in',
        counterpartyAccount: null,
        ourAccount: 'UA-C',
      },
    ]);
    expect([...pair.counterOf]).toEqual([['b', 'a']]);
  });

  it('does not guess between two possible exchanges', () => {
    const leg = (
      key: string,
      accountId: string,
      currency: string,
      direction: 'in' | 'out',
      amount: string,
      purpose: string,
    ): PairingRow => ({
      key,
      accountId,
      currency,
      direction,
      amount,
      purpose,
      occurredOn: '2026-10-05' as LocalDate,
      ref: null,
      docNumber: null,
      counterpartyAccount: null,
      ourAccount: null,
    });
    const pair = pairStatementRows([
      leg('d1', 'usd', 'USD', 'out', '100', 'Продаж 100.00 USD'),
      leg('d2', 'usd2', 'USD', 'out', '100', 'Продаж 100.00 USD'),
      leg('c1', 'uah', 'UAH', 'in', '4400', 'Гривні від продажу 100.00 USD'),
    ]);
    expect(pair.counterOf.size).toBe(0);
  });
});

// Synthetic statement in the Privat24 layout with one signed «Сума» column: newest first, each
// fee right below its payment, and a payment rejected by the receiving bank and sent again.
const SIGNED_CSV = [
  'ЄДРПОУ;МФО;Рахунок;Валюта;Номер документу;Дата операції;МФО банку;Назва банку;Рахунок кореспондента;ЄДРПОУ кореспондента;Кореспондент;Сума;Призначення платежу;',
  '10000000;305299;UA000000000000000000000005293;UAH;139;19.10.2026;305299;Банк;UA333;1111111111;ФОП ТЕСТ;-107 852.98;ОПЛАТА ЗА ПОСЛУГИ ЗГIДНО ДОГОВОРУ № OD-9;',
  '10000000;305299;UA000000000000000000000005293;UAH;FEE139Y;19.10.2026;305299;Банк;UA999;14360570;ЗА ДЕБЕТУВАННЯ РАХУНКУ(UAH);-15.00;Комiсiя за виконання платежiв в нацiональнiй валютi у сумi 107852.98 грн вiд 19.10.2026, без ПДВ.;',
  '10000000;305299;UA000000000000000000000005293;UAH;137;19.10.2026;305299;Банк;UA333;1111111111;ФОП ТЕСТ;107 852.98;NARR: Повернення платiжної iнструкцiї № 137 вiд 19/10/2026 у зв`язку з невiдповiднiстю реквiзитiв;',
  '10000000;305299;UA000000000000000000000005293;UAH;138;19.10.2026;305299;Банк;UA444;2222222222;ТЕСТ ЛЮБОВ;-30 159.30;НАДАННЯ ПОСЛУГ ЗГIДНО АКТУ № 12;',
  '10000000;305299;UA000000000000000000000005293;UAH;FEE138Y;19.10.2026;305299;Банк;UA999;14360570;ЗА ДЕБЕТУВАННЯ РАХУНКУ(UAH);-5.00;Комiсiя за виконання платежiв в нацiональнiй валютi у сумi 30159.30 грн вiд 19.10.2026, без ПДВ.;',
  '10000000;305299;UA000000000000000000000005293;UAH;137;19.10.2026;305299;Банк;UA333;1111111111;ФОП ТЕСТ;-107 852.98;ОПЛАТА ЗА ПОСЛУГИ ЗГIДНО ДОГОВОРУ № OD-9;',
  '10000000;305299;UA000000000000000000000005293;UAH;FEE137Y;19.10.2026;305299;Банк;UA999;14360570;ЗА ДЕБЕТУВАННЯ РАХУНКУ(UAH);-15.00;Комiсiя за виконання платежiв в нацiональнiй валютi у сумi 107852.98 грн вiд 19.10.2026, без ПДВ.;',
  '10000000;305299;UA000000000000000000000005293;UAH;QSALE1;19.10.2026;305299;Банк;UA888;14360570;Продаж UAH клiєнтiв;26 940.00;Гривнi вiд продажу 600.00 USD по курсу 44.9;',
  '10000000;305299;UA000000000000000000000005293;UAH;QSALE2;19.10.2026;305299;Банк;UA777;14360570;Ком.за в/о;-53.84;Списання комiсiї на здiйснення валютно-обмiнної операцiї вiд 19.10.2026, 600.00, USD, RIDSQ1, згiдно з тарифами банку, без ПДВ;',
  '10000000;305299;UA000000000000000000000005293;UAH;AS1;02.10.2026;305299;Банк;UA666;14360570;ОБСЛУГ. ПОТ. РАХУНКIВ(UAH);-225.00;Комiсiя за обслуговування рахунку за вересень 2026 р.;',
].join('\n');

const SIGNED_USD_CSV = [
  'ЄДРПОУ;МФО;Рахунок;Валюта;Номер документу;Дата операції;МФО банку;Назва банку;Рахунок кореспондента;ЄДРПОУ кореспондента;Кореспондент;Сума;Призначення платежу;',
  '10000000;305299;UA000000000000000000000001648;USD;55;19.10.2026;305299;Банк;UA555;14360570;Банк;-600.00;Продаж 600.00 USD по курсу 44.9;',
].join('\n');

describe('pairStatementRows on a signed-amount statement', () => {
  const uah = parse(SIGNED_CSV).rows;
  const usd = parse(SIGNED_USD_CSV).rows;
  const rows: PairingRow[] = [
    ...uah.map((r) => ({
      ...r,
      key: `u${String(r.line)}`,
      accountId: 'uah',
      currency: 'UAH',
      file: 'uah.csv',
    })),
    ...usd.map((r) => ({
      ...r,
      key: `d${String(r.line)}`,
      accountId: 'usd',
      currency: 'USD',
      file: 'usd.csv',
    })),
  ];
  const byDoc = (doc: string, direction: 'in' | 'out') =>
    rows.find((r) => r.docNumber === doc && r.direction === direction)?.key;
  const byRef = (ref: string) => rows.find((r) => r.ref === ref || r.docNumber === ref)?.key;
  const pairing = pairStatementRows(rows);

  it('attaches a hryvnia payment fee by the amount it names', () => {
    expect(pairing.feeOf.get(byRef('FEE138Y') ?? '')).toBe(byDoc('138', 'out'));
  });

  it('attaches an exchange fee that writes «600.00, USD» to the USD leg', () => {
    expect(pairing.counterOf.get(byRef('QSALE1') ?? '')).toBe(byDoc('55', 'out'));
    expect(pairing.feeOf.get(byRef('QSALE2') ?? '')).toBe(byDoc('55', 'out'));
  });

  it('pairs a rejected payment with its return and each same-amount fee with its own payment', () => {
    expect(pairing.returnOf.get(byDoc('137', 'in') ?? '')).toBe(byDoc('137', 'out'));
    expect(pairing.feeOf.get(byRef('FEE137Y') ?? '')).toBe(byDoc('137', 'out'));
    expect(pairing.feeOf.get(byRef('FEE139Y') ?? '')).toBe(byDoc('139', 'out'));
    expect(pairing.counterOf.has(byDoc('137', 'in') ?? '')).toBe(false);
  });

  it('leaves the monthly account service charge alone', () => {
    expect(pairing.feeOf.has(byRef('AS1') ?? '')).toBe(false);
  });
});

describe('«Номер документу» without a reference column', () => {
  it('keeps our order numbers and reads bank rows as references', () => {
    const rows = parse(SIGNED_CSV).rows;
    expect(rows[0]).toMatchObject({ docNumber: '139', ref: null });
    expect(rows[1]).toMatchObject({ docNumber: null, ref: 'FEE139Y' });
    expect(statementExternalRef(rows[0] as StatementRow, '5293')).toBe(
      'privat:5293:2026-10-19:139:107852.98',
    );
    expect(statementExternalRef(rows[1] as StatementRow, '5293')).toBe('privat:FEE139Y');
  });
});

describe('paymentFeeHints', () => {
  it('reads the amount of a SWIFT fee and the number of a payment fee', () => {
    expect(
      paymentFeeHints({
        direction: 'out',
        purpose: 'Комiсiя за мiжнародний переказ вiд 14-10-2026, сума 3000.00 USD, реф. JBK1',
      }),
    ).toEqual({ amounts: ['3000.00 USD'], docNumbers: [] });
    expect(paymentFeeHints({ direction: 'out', purpose: 'Комiсiя за платiж № 126' })).toEqual({
      amounts: [],
      docNumbers: ['126'],
    });
  });

  it('is null for the account service charge and for non-fee rows', () => {
    expect(
      paymentFeeHints({ direction: 'out', purpose: 'Комiсiя за обслуговування рахунку' }),
    ).toBeNull();
    expect(paymentFeeHints({ direction: 'out', purpose: 'Оплата послуг' })).toBeNull();
  });
});
