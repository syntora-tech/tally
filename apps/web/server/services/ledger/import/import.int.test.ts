import { randomBytes, randomUUID } from 'node:crypto';
import {
  account,
  category,
  ledgerImport,
  payee,
  person,
  posting,
  transaction,
  userSecret,
} from '@tally/db/schema';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { err, ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClaudeClient, SuggestionOutput } from '../../../ai/claude';
import type { ChainReader, ChainTransfer } from '../../../chain';
import { intHarness } from '../../../../test/int-helpers';
import { aiKeyStatus, deleteAiKey, saveAiKey } from '../../ai';
import type { ServiceContext } from '../../context';
import { createTransaction, listAccounts } from '..';
import {
  commitImport,
  discardImport,
  getImport,
  prepareBankImport,
  prepareCryptoImport,
  suggestImportWithAi,
  type Decision,
  type ImportRow,
} from '.';

const h = intHarness('2045-06-20');
const tag = randomUUID().slice(0, 8);
const encryptionKey = randomBytes(32).toString('base64');
const uahName = `I ${tag} UAH`;
const usdName = `I ${tag} USD`;
const usdtName = `I ${tag} USDT`;
const gasName = `I ${tag} TRX`;
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const tronAddress = () => `T${[...randomBytes(33)].map((b) => BASE58[b % 58] ?? '1').join('')}`;
const tron = tronAddress();
const friend = tronAddress();
const taxId = String(3_000_000_000 + Math.floor(Math.random() * 99_999_999));

let owner: Awaited<ReturnType<typeof h.user>>;
let otherOwner: Awaited<ReturnType<typeof h.user>>;
const ids: Record<string, string> = {};
let personId = '';

/** Records what Claude was asked; answers every row with the given category. */
function fakeClaude(answer: (keys: string[]) => SuggestionOutput, calls: string[][] = []) {
  return (apiKey: string): ClaudeClient => ({
    verify: () =>
      Promise.resolve(apiKey.endsWith('good-key-0000') ? ok(undefined) : err('invalid_key')),
    suggest: ({ user }) => {
      const rows = /<rows>\n(.*)\n<\/rows>/s.exec(user)?.[1] ?? '[]';
      const keys = (JSON.parse(rows) as { key: string }[]).map((r) => r.key);
      calls.push(keys);
      return Promise.resolve(
        ok({ output: answer(keys), usage: { inputTokens: 10, outputTokens: 5 } }),
      );
    },
  });
}

const transfers: ChainTransfer[] = [];
const chain: ChainReader = {
  tokenTransfers: ({ address, contract }) =>
    Promise.resolve(
      ok({
        transfers: transfers.filter(
          (t) => t.contract === contract && (t.from === address || t.to === address),
        ),
        truncated: false,
      }),
    ),
  transactionFee: ({ hash }) =>
    Promise.resolve(ok({ payer: tron, fee: hash.endsWith('aa') ? '13450000' : '0' })),
};

function ctxOf(u: typeof owner, claude = fakeClaude(() => ({ items: [] }))): ServiceContext {
  const base = h.ctxFor(u);
  return { ...base, config: { ...base.config, encryptionKey, integrations: { claude, chain } } };
}

const file = (name: string, text: string) => new File([text], name, { type: 'text/csv' });

const header =
  'ЄДРПОУ;Рахунок;Валюта;Дата операції;Референс;Номер документа;Дебет;Кредит;Призначення платежу;Кореспондент;ЄДРПОУ кореспондента';
const uahCsv = (lines: string[]) => [header, ...lines].join('\n');
const UAH_ACC = `UA00000000000000000${tag.replace(/\D/g, '1').slice(0, 6).padEnd(6, '1')}5293`;
const USD_ACC = `UA00000000000000000${tag.replace(/\D/g, '2').slice(0, 6).padEnd(6, '2')}1648`;

const decisionsOf = (
  rows: ImportRow[],
  override: Partial<Record<string, Partial<Decision>>> = {},
): Decision[] =>
  rows.map((r) => ({
    key: r.key,
    include: r.status === 'new' || r.status === 'match',
    type: r.suggestion?.type ?? (r.direction === 'in' ? 'revenue' : 'expense'),
    categoryId: r.suggestion?.categoryId ?? null,
    personId: r.suggestion?.personId ?? null,
    clientId: r.suggestion?.clientId ?? null,
    description: r.suggestion?.description ?? null,
    attachTo: r.attachTo,
    ...override[r.key],
  }));

const draftRows = async (ctx: ServiceContext, id: string) =>
  (await getImport.run(ctx, { id }))._unsafeUnwrap().rows;

beforeAll(async () => {
  owner = await h.user('owner');
  otherOwner = await h.user('owner');
  const rows = await h.db
    .insert(account)
    .values([
      {
        name: uahName,
        kind: 'bank',
        currency: 'UAH',
        openingBalance: '0',
        openingDate: '2045-06-01',
      },
      {
        name: usdName,
        kind: 'bank',
        currency: 'USD',
        openingBalance: '0',
        openingDate: '2045-06-01',
      },
      {
        name: usdtName,
        kind: 'crypto',
        currency: 'USDT',
        network: 'TRON',
        address: tron,
        openingBalance: '0',
        openingDate: '2045-06-01',
      },
      {
        name: gasName,
        kind: 'crypto',
        currency: 'TRX',
        network: 'TRON',
        openingBalance: '0',
        openingDate: '2045-06-01',
      },
    ])
    .returning({ id: account.id, name: account.name });
  for (const r of rows) ids[r.name] = r.id;
  const [p] = await h.db
    .insert(person)
    .values({ fullName: `I ${tag} Contractor` })
    .returning({ id: person.id });
  personId = p?.id ?? '';
  await h.db.insert(payee).values({ kind: 'fop', legalNameUa: `ФОП I ${tag}`, taxId, personId });
  for (const name of ['Contractors', 'Taxes', 'FX Exchange', 'Bank Fees', 'Client Revenue']) {
    const [c] = await h.db
      .select({ id: category.id })
      .from(category)
      .where(eq(category.name, name));
    ids[name] = c?.id ?? '';
  }
});

afterAll(() =>
  h.cleanup(async (db) => {
    const ours = await db
      .select({ id: account.id })
      .from(account)
      .where(like(account.name, `I ${tag}%`));
    const accountIds = ours.map((a) => a.id);
    if (accountIds.length) {
      const txs = await db
        .selectDistinct({ id: posting.transactionId })
        .from(posting)
        .where(inArray(posting.accountId, accountIds));
      if (txs.length)
        await db.delete(transaction).where(
          inArray(
            transaction.id,
            txs.map((t) => t.id),
          ),
        );
    }
    await db.execute(`set session_replication_role = replica`);
    await db
      .delete(ledgerImport)
      .where(or(eq(ledgerImport.createdBy, owner.id), eq(ledgerImport.createdBy, otherOwner.id)));
    await db.execute(`set session_replication_role = origin`);
    await db.delete(userSecret).where(inArray(userSecret.userId, [owner.id, otherOwner.id]));
    await db.delete(account).where(like(account.name, `I ${tag}%`));
    await db.delete(payee).where(eq(payee.taxId, taxId));
    await db.delete(person).where(eq(person.id, personId));
  }),
);

describe('personal AI key (A-120)', () => {
  it('is verified, stored encrypted, visible only to its owner, and removable', async () => {
    const ctx = ctxOf(owner);
    expect((await aiKeyStatus.run(ctx, {}))._unsafeUnwrap()).toMatchObject({
      available: true,
      hint: null,
    });
    const bad = await saveAiKey.run(ctx, { apiKey: 'sk-ant-api03-bad-key-1234567890abcd' });
    expect(bad._unsafeUnwrapErr().fieldErrors?.apiKey).toEqual(['ai.keyRejected']);
    const oauth = await saveAiKey.run(ctx, { apiKey: 'sk-ant-oat01-subscription-token-123456' });
    expect(oauth._unsafeUnwrapErr().fieldErrors?.apiKey).toEqual(['ai.subscriptionToken']);

    const saved = await saveAiKey.run(ctx, { apiKey: ' sk-ant-api03-test-good-key-0000 ' });
    expect(saved._unsafeUnwrap()).toEqual({ hint: '0000' });
    const [row] = await h.db.select().from(userSecret).where(eq(userSecret.userId, owner.id));
    expect(row?.ciphertext.startsWith('v1:')).toBe(true);
    expect(row?.ciphertext).not.toContain('good-key');
    expect((await aiKeyStatus.run(ctx, {}))._unsafeUnwrap().hint).toBe('0000');
    expect((await aiKeyStatus.run(ctxOf(otherOwner), {}))._unsafeUnwrap().hint).toBeNull();

    const noServerKey = {
      ...ctx,
      config: { ...ctx.config, encryptionKey: undefined },
    } as ServiceContext;
    expect((await aiKeyStatus.run(noServerKey, {}))._unsafeUnwrap().available).toBe(false);
    expect(
      (
        await saveAiKey.run(noServerKey, { apiKey: 'sk-ant-api03-test-good-key-0000' })
      )._unsafeUnwrapErr().message,
    ).toBe('ai.notConfigured');

    await deleteAiKey.run(ctxOf(otherOwner), {});
    expect((await aiKeyStatus.run(ctx, {}))._unsafeUnwrap().hint).toBe('0000');
    await deleteAiKey.run(ctx, {});
    expect((await aiKeyStatus.run(ctx, {}))._unsafeUnwrap().hint).toBeNull();
  });

  it('keeps AI features off without a key', async () => {
    const result = await prepareCryptoImport.run(ctxOf(otherOwner), {});
    expect(result._unsafeUnwrapErr().message).toBe('ai.keyMissing');
  });
});

describe('bank statement import (A-121)', () => {
  const ref = (n: number) => `R${tag}${String(n)}`;
  const uah = uahCsv([
    `1;${UAH_ACC};UAH;02.06.2045;${ref(1)};126;45 624,60;;ОПЛАТА ЗА ПОСЛУГИ ЗГIДНО ДОГОВОРУ;ФОП I ${tag};${taxId}`,
    `1;${UAH_ACC};UAH;02.06.2045;${ref(2)};127;5,00;;Комiсiя за платiж № 126;ПРИВАТБАНК;14360570`,
    `1;${UAH_ACC};UAH;02.06.2045;${ref(3)};;;143 136,00;Гривнi вiд продажу 3200.00 USD по курсу 44.73;ПРИВАТБАНК;14360570`,
    `1;${UAH_ACC};UAH;07.06.2045;${ref(4)};129;282,00;;Вiйськовий збiр;ГОЛОВНЕ УДКСУ;37607526`,
    `1;${UAH_ACC};UAH;15.05.2045;${ref(5)};100;10,00;;Before the books;ПРИВАТБАНК;14360570`,
  ]);
  const usd = [
    header,
    `1;${USD_ACC};USD;02.06.2045;${ref(6)};;3200.00;;Продаж 3200.00 USD по курсу 44.73;ПРИВАТБАНК;14360570`,
  ].join('\n');

  it('refuses a statement whose currency is not the account’s', async () => {
    const result = await prepareBankImport.run(ctxOf(owner), {
      files: [file('usd.csv', usd)],
      accountId: ids[uahName],
    });
    expect(result._unsafeUnwrapErr().fieldErrors?.files?.[0]).toContain('import.currencyMismatch');
  });

  it('remembers which account a statement belongs to', async () => {
    const ctx = ctxOf(owner);
    for (const [name, csv] of [
      [uahName, uah],
      [usdName, usd],
    ] as const) {
      const first = await prepareBankImport.run(ctx, {
        files: [file(`${name}.csv`, csv)],
        accountId: ids[name],
      });
      await discardImport.run(ctx, { id: first._unsafeUnwrap().id });
    }
    const both = await prepareBankImport.run(ctx, {
      files: [file('uah.csv', uah), file('usd.csv', usd)],
    });
    const rows = await draftRows(ctx, both._unsafeUnwrap().id);
    expect(new Set(rows.map((r) => r.accountId))).toEqual(new Set([ids[uahName], ids[usdName]]));
    await discardImport.run(ctx, { id: both._unsafeUnwrap().id });
  });

  it('pairs the exchange, attaches the fee, links a hand-entered row and books in one go', async () => {
    const ctx = ctxOf(owner);
    // The tax payment was entered by hand before the statement arrived.
    const manual = await createTransaction.run(ctx, {
      type: 'expense',
      occurredOn: '2045-06-07',
      categoryId: ids.Taxes,
      from: { accountId: ids[uahName], amount: '282' },
    });
    const prepared = await prepareBankImport.run(ctx, {
      files: [file('uah.csv', uah), file('usd.csv', usd)],
    });
    const id = prepared._unsafeUnwrap().id;
    const rows = await draftRows(ctx, id);
    const by = (r: string) => rows.find((x) => x.ref === r) as ImportRow;

    expect(by(ref(1)).suggestion).toMatchObject({ personId, source: 'payee' });
    expect(by(ref(2)).attachTo).toBe(by(ref(1)).key);
    expect(by(ref(3)).attachTo).toBe(by(ref(6)).key);
    expect(by(ref(6)).suggestion).toMatchObject({
      type: 'fx_exchange',
      categoryId: ids['FX Exchange'],
    });
    expect(by(ref(4))).toMatchObject({ status: 'match', existingId: manual._unsafeUnwrap().id });
    expect(by(ref(5)).status).toBe('before_opening');

    const decisions = decisionsOf(rows, { [by(ref(1)).key]: { categoryId: ids.Contractors } });
    const dry = await commitImport.run(ctx, { importId: id, decisions, dryRun: true });
    expect(dry._unsafeUnwrap().created).toBe(2);
    expect((await getImport.run(ctx, { id }))._unsafeUnwrap().status).toBe('draft');

    const done = await commitImport.run(ctx, { importId: id, decisions });
    expect(done._unsafeUnwrap()).toMatchObject({ created: 2, linked: 1 });
    const balances = (await listAccounts.run(ctx, {}))._unsafeUnwrap();
    const balanceOf = (name: string) => balances.find((b) => b.account.name === name)?.balance;
    // 143 136 − 45 624.60 − 5 fee − 282 tax; 3 200 USD out.
    expect(Number(balanceOf(uahName))).toBeCloseTo(97_224.4, 2);
    expect(Number(balanceOf(usdName))).toBe(-3200);

    const [fx] = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.externalRef, `privat:${ref(6)}`));
    expect(fx?.description).toContain(`credit ref ${ref(3)}`);
    const [linked] = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.id, manual._unsafeUnwrap().id));
    expect(linked?.externalRef).toBe(`privat:${ref(4)}`);

    expect(
      (await commitImport.run(ctx, { importId: id, decisions }))._unsafeUnwrapErr().message,
    ).toBe('import.notDraft');
  });

  it('recognises every row of the same statement on a second upload', async () => {
    const ctx = ctxOf(owner);
    const again = await prepareBankImport.run(ctx, {
      files: [file('uah.csv', uah), file('usd.csv', usd)],
    });
    const rows = await draftRows(ctx, again._unsafeUnwrap().id);
    expect(rows.map((r) => r.status).sort()).toEqual([
      'before_opening',
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
      'duplicate',
    ]);
    const nothing = await commitImport.run(ctx, {
      importId: again._unsafeUnwrap().id,
      decisions: decisionsOf(rows),
    });
    expect(nothing._unsafeUnwrapErr().message).toBe('import.nothingChosen');
  });

  it('rolls everything back when one row is wrong and says which', async () => {
    const ctx = ctxOf(owner);
    const csv = uahCsv([
      `1;${UAH_ACC};UAH;10.06.2045;${ref(7)};130;100,00;;Оплата;ТОВ Ромашка ${tag};12345678`,
      `1;${UAH_ACC};UAH;10.06.2045;${ref(8)};131;200,00;;Оплата;ТОВ Волошка ${tag};12345679`,
    ]);
    const id = (
      await prepareBankImport.run(ctx, { files: [file('a.csv', csv)], accountId: ids[uahName] })
    )._unsafeUnwrap().id;
    const rows = await draftRows(ctx, id);
    const [a, b] = rows as [ImportRow, ImportRow];
    const result = await commitImport.run(ctx, {
      importId: id,
      decisions: decisionsOf(rows, {
        [a.key]: { categoryId: ids.Contractors },
        [b.key]: { type: 'revenue', categoryId: ids['Client Revenue'] },
      }),
    });
    expect(result._unsafeUnwrapErr().fieldErrors?.[`rows.${b.key}`]).toEqual([
      'import.revenueIsIn',
    ]);
    const booked = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.externalRef, `privat:${ref(7)}`));
    expect(booked).toHaveLength(0);
    expect((await getImport.run(ctx, { id }))._unsafeUnwrap().status).toBe('draft');
  });

  it('lets Claude fill missing categories with ids that exist only', async () => {
    const calls: string[][] = [];
    const claude = fakeClaude(
      (keys) => ({
        items: keys.map((key, i) => ({
          key,
          type: 'expense',
          categoryId: i === 0 ? (ids.Contractors ?? null) : randomUUID(),
          personId: randomUUID(),
          clientId: null,
          description: 'ignored for bank rows',
          confidence: 'high',
          reason: 'test',
        })),
      }),
      calls,
    );
    const ctx = ctxOf(owner, claude);
    expect((await saveAiKey.run(ctx, { apiKey: 'sk-ant-api03-test-good-key-0000' })).isOk()).toBe(
      true,
    );
    const csv = uahCsv([
      `1;${UAH_ACC};UAH;11.06.2045;${ref(9)};132;300,00;;Оплата;ТОВ Айстра ${tag};22345678`,
      `1;${UAH_ACC};UAH;11.06.2045;${ref(10)};133;400,00;;Оплата;ТОВ Мальва ${tag};22345679`,
    ]);
    const id = (
      await prepareBankImport.run(ctx, { files: [file('b.csv', csv)], accountId: ids[uahName] })
    )._unsafeUnwrap().id;
    const result = await suggestImportWithAi.run(ctx, { importId: id });
    expect(result._unsafeUnwrap().suggested).toBe(2);
    expect(calls.flat()).toHaveLength(2);
    const rows = await draftRows(ctx, id);
    expect(rows[0]?.suggestion).toMatchObject({
      source: 'ai',
      categoryId: ids.Contractors,
      personId: null,
      description: null,
    });
    expect(rows[1]?.suggestion).toMatchObject({ categoryId: null, confidence: 'low' });
    await deleteAiKey.run(ctx, {});
    expect((await suggestImportWithAi.run(ctx, { importId: id }))._unsafeUnwrapErr().message).toBe(
      'ai.keyMissing',
    );
  });
});

describe('bank fees of payments already in the Ledger (A-123)', () => {
  const signedHeader =
    'ЄДРПОУ;МФО;Рахунок;Валюта;Номер документу;Дата операції;МФО банку;Назва банку;Рахунок кореспондента;ЄДРПОУ кореспондента;Кореспондент;Сума;Призначення платежу;';
  const line = (doc: string, date: string, amount: string, who: string, purpose: string) =>
    `1;305299;${UAH_ACC};UAH;${doc};${date};305299;Банк;UA333;14360570;${who};${amount};${purpose};`;
  const fee = (doc: string, date: string, amount: string, of: string) =>
    line(
      doc,
      date,
      `-${amount}`,
      'ЗА ДЕБЕТУВАННЯ РАХУНКУ(UAH)',
      `Комiсiя за виконання платежiв в нацiональнiй валютi у сумi ${of} грн вiд ${date}, без ПДВ.`,
    );
  const csv = (rows: string[]) => [signedHeader, ...rows].join('\n');
  // Our payment orders are numbered; bank rows carry a reference in the same column.
  const docBase = (parseInt(tag.slice(0, 6), 16) % 900_000) + 100_000;
  const doc = (n: number) => String(docBase * 100 + n);
  const payment = line(doc(38), '20.06.2045', '-30 159.30', `ФОП I ${tag}`, 'Оплата за актом');
  const statement = csv([
    line(doc(39), '21.06.2045', '-107 852.98', `ФОП I ${tag}`, 'Оплата послуг'),
    fee(`F${doc(39)}`, '21.06.2045', '15.00', '107852.98'),
    line(
      doc(37),
      '21.06.2045',
      '107 852.98',
      `ФОП I ${tag}`,
      `NARR: Повернення платiжної iнструкцiї № ${doc(37)} вiд 21/06/2045 у зв\`язку з невiдповiднiстю реквiзитiв`,
    ),
    payment,
    fee(`F${doc(38)}`, '20.06.2045', '5.00', '30159.30'),
    line(doc(37), '21.06.2045', '-107 852.98', `ФОП I ${tag}`, 'Оплата послуг'),
    fee(`F${doc(37)}`, '21.06.2045', '15.00', '107852.98'),
    line(
      `S${doc(1)}`,
      '22.06.2045',
      '-2 321.63',
      'Комiсiя за SWIFT-переказ',
      'Комiсiя за мiжнародний переказ вiд 22-06-2045, сума 3000.00 USD, реф. JBK1, без ПДВ.',
    ),
  ]);
  let swiftId = '';

  beforeAll(async () => {
    const ctx = ctxOf(owner);
    // The payment came in an earlier statement, without its fee.
    const first = (
      await prepareBankImport.run(ctx, {
        files: [file('first.csv', csv([payment]))],
        accountId: ids[uahName],
      })
    )._unsafeUnwrap().id;
    const firstRows = await draftRows(ctx, first);
    await commitImport.run(ctx, {
      importId: first,
      decisions: decisionsOf(firstRows, {
        [firstRows[0]?.key ?? '']: { categoryId: ids.Contractors },
      }),
    });
    // A SWIFT payout recorded with Pay, its fee an estimate on the UAH account.
    swiftId = (
      await createTransaction.run(ctx, {
        type: 'expense',
        occurredOn: '2045-06-22',
        categoryId: ids.Contractors,
        from: { accountId: ids[usdName], amount: '3000' },
        fee: { accountId: ids[uahName], amount: '51' },
      })
    )._unsafeUnwrap().id;
  });

  it('puts each fee into its own payment, also one booked earlier, and keeps a returned payment out', async () => {
    const ctx = ctxOf(owner);
    const id = (
      await prepareBankImport.run(ctx, {
        files: [file('second.csv', statement)],
        accountId: ids[uahName],
      })
    )._unsafeUnwrap().id;
    const rows = await draftRows(ctx, id);
    const by = (d: string, direction: 'in' | 'out' = 'out') =>
      rows.find((r) => (r.docNumber ?? r.ref) === d && r.direction === direction) as ImportRow;
    const [earlier] = await h.db
      .select({ id: transaction.id })
      .from(transaction)
      .where(like(transaction.externalRef, `%:${doc(38)}:%`));

    expect(by(doc(38)).status).toBe('duplicate');
    expect(by(`F${doc(38)}`)).toMatchObject({
      status: 'fee_for_existing',
      existingId: earlier?.id,
      replacesFee: null,
    });
    expect(by(`S${doc(1)}`)).toMatchObject({
      status: 'fee_for_existing',
      existingId: swiftId,
      replacesFee: { accountId: ids[uahName], amount: '51' },
    });
    expect(by(doc(37)).status).toBe('returned');
    expect(by(doc(37), 'in').status).toBe('returned');
    expect(by(`F${doc(37)}`)).toMatchObject({ status: 'new', attachTo: null });
    expect(by(`F${doc(37)}`).flags).toContain('fee_of_returned');
    expect(by(`F${doc(39)}`).attachTo).toBe(by(doc(39)).key);

    const decisions = decisionsOf(rows, {
      [by(doc(39)).key]: { categoryId: ids.Contractors },
      [by(`F${doc(37)}`).key]: { categoryId: ids['Bank Fees'] },
      [by(`F${doc(38)}`).key]: { include: true },
      [by(`S${doc(1)}`).key]: { include: true },
    });
    const done = await commitImport.run(ctx, { importId: id, decisions });
    expect(done._unsafeUnwrap()).toMatchObject({ created: 2, fees: 2 });

    const feesOf = async (txId: string) =>
      (await h.db.select().from(posting).where(eq(posting.transactionId, txId)))
        .filter((p) => p.isFee)
        .map((p) => p.amount);
    expect(await feesOf(earlier?.id ?? '')).toEqual(['-5.00000000']);
    expect(await feesOf(swiftId)).toEqual(['-2321.63000000']);
    const balances = (await listAccounts.run(ctx, {}))._unsafeUnwrap();
    const before = Number(balances.find((b) => b.account.name === uahName)?.balance);

    const again = await prepareBankImport.run(ctx, {
      files: [file('second.csv', statement)],
      accountId: ids[uahName],
    });
    const second = await draftRows(ctx, again._unsafeUnwrap().id);
    expect(second.filter((r) => r.status !== 'duplicate' && r.status !== 'returned')).toEqual([]);
    await discardImport.run(ctx, { id: again._unsafeUnwrap().id });
    // −107 852.98 − 15 sent again, −15 fee of the rejected one, −5 and −(2 321.63 − 51) fee changes.
    expect(before).toBeCloseTo(-30_159.3 + 97_224.4 - 107_852.98 - 15 - 15 - 5 - 2_321.63, 2);
  });
});

describe('crypto import with AI (A-122)', () => {
  const hash = (n: number, end = '00') =>
    `${tag}${String(n).padStart(4, '0')}`.padEnd(62, 'b') + end;
  const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

  it('reads only real USDT, books gas on the gas account, and never writes before review', async () => {
    transfers.push(
      {
        hash: hash(1, 'aa'),
        logIndex: 0,
        at: new Date('2045-06-03T10:00:00Z'),
        from: tron,
        to: friend,
        contract: USDT,
        value: '1500000000',
      },
      {
        hash: hash(2),
        logIndex: 0,
        at: new Date('2045-06-04T22:30:00Z'),
        from: friend,
        to: tron,
        contract: USDT,
        value: '250000',
      },
      {
        hash: hash(3),
        logIndex: 0,
        at: new Date('2045-06-05T10:00:00Z'),
        from: friend,
        to: tron,
        contract: 'TXfakeUSDTlookalike000000000000000',
        value: '9000000000',
      },
      {
        hash: hash(4),
        logIndex: 0,
        at: new Date('2045-05-20T10:00:00Z'),
        from: friend,
        to: tron,
        contract: USDT,
        value: '5000000',
      },
    );
    const calls: string[][] = [];
    const claude = fakeClaude(
      (keys) => ({
        items: keys.map((key) => ({
          key,
          type: 'expense',
          categoryId: ids.Contractors ?? null,
          personId,
          clientId: null,
          description: 'USDT payout to the contractor',
          confidence: 'medium',
          reason: 'matches an open payout',
        })),
      }),
      calls,
    );
    const ctx = ctxOf(owner, claude);
    await saveAiKey.run(ctx, { apiKey: 'sk-ant-api03-test-good-key-0000' });
    const prepared = await prepareCryptoImport.run(ctx, { from: '2045-06-01' });
    const { id, aiError } = prepared._unsafeUnwrap();
    expect(aiError).toBeNull();
    const rows = (await draftRows(ctx, id)).filter((r) => r.accountId === ids[usdtName]);
    expect(rows.map((r) => [r.direction, r.amount, r.occurredOn])).toEqual([
      ['out', '1500', '2045-06-03'],
      ['in', '0.25', '2045-06-05'], // 22:30 UTC is the next day in Kyiv
    ]);
    const [payout, dust] = rows as [ImportRow, ImportRow];
    expect(payout.fee).toEqual({ accountId: ids[gasName], amount: '13.45' });
    expect(payout.suggestion).toMatchObject({
      source: 'ai',
      personId,
      description: 'USDT payout to the contractor',
    });
    expect(dust.flags).toContain('dust');
    // The dust row came in, so Claude's "expense" became the only possible type.
    expect(dust.suggestion?.type).toBe('revenue');
    expect(
      await h.db.select().from(transaction).where(eq(transaction.externalRef, payout.externalRef)),
    ).toHaveLength(0);

    const decisions = decisionsOf(rows).map((d) =>
      d.key === dust.key ? { ...d, include: false } : d,
    );
    expect((await commitImport.run(ctx, { importId: id, decisions }))._unsafeUnwrap().created).toBe(
      1,
    );
    const [booked] = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.externalRef, payout.externalRef));
    expect(booked).toMatchObject({
      personId,
      counterpartyAddress: friend,
      description: 'USDT payout to the contractor',
    });
    const legs = await h.db
      .select()
      .from(posting)
      .where(and(eq(posting.transactionId, booked?.id ?? '')));
    expect(
      legs
        .map((l) => [l.accountId === ids[gasName] ? 'gas' : 'usdt', Number(l.amount), l.isFee])
        .sort(),
    ).toEqual([
      ['gas', -13.45, true],
      ['usdt', -1500, false],
    ]);

    const again = await prepareCryptoImport.run(ctx, { from: '2045-06-01' });
    const second = (await draftRows(ctx, again._unsafeUnwrap().id)).filter(
      (r) => r.accountId === ids[usdtName],
    );
    expect(second.find((r) => r.ref === payout.ref)?.status).toBe('duplicate');
  });
});
