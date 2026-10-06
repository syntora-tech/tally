import {
  account,
  allocation,
  assignment,
  category,
  fxRate,
  paymentCharge,
  payrollItem,
  payrollLine,
  period,
  person,
  plannedExpense,
  plannedPayment,
  posting,
  transaction,
} from '@tally/db/schema';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { createTransaction } from '../ledger';
import { payItem } from '../payroll';
import { deletePlannedExpense, savePaymentCharge, savePlannedExpense } from '.';
import {
  listPlannedPayments,
  markPlannedPaid,
  setPlannedAmount,
  skipPlannedPayment,
  unlinkPlannedPayment,
  unskipPlannedPayment,
} from './payments';

const h = intHarness('2042-08-15');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  person: '',
  payroll: '',
  rule: '',
  uah: '',
  usd: '',
  period: '',
  assignment: '',
  item: '',
  personCharge: '',
  transactions: [] as string[],
};
const cat = { payroll: '', taxes: '' };

beforeAll(async () => {
  finance = await h.user('finance');
  const cats = await h.db.select().from(category).where(eq(category.txType, 'expense'));
  cat.payroll = cats.find((c) => c.name === 'Payroll')?.id ?? '';
  cat.taxes = cats.find((c) => c.name === 'Taxes')?.id ?? '';
  const [director] = await h.db.insert(person).values({ fullName: 'Int Director' }).returning();
  const [worker] = await h.db.insert(person).values({ fullName: 'Int Abroad' }).returning();
  const [uah] = await h.db
    .insert(account)
    .values({
      name: `Planned UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2042-01-01',
    })
    .returning();
  const [usd] = await h.db
    .insert(account)
    .values({
      name: `Planned USD ${String(Date.now())}`,
      kind: 'bank',
      currency: 'USD',
      openingDate: '2042-01-01',
    })
    .returning();
  await h.db
    .insert(fxRate)
    .values({ onDate: '2042-08-01', base: 'USD', quote: 'UAH', rate: '41.5', source: 'nbu' });
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: worker?.id ?? '', isInternal: true, startsOn: '2042-01-01' })
    .returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2042-07-01', workHours: '184' })
    .returning();
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: per?.id ?? '',
      personId: worker?.id ?? '',
      payoutMethod: 'crypto',
      totalUsd: '3000',
    })
    .returning();
  await h.db.insert(payrollLine).values({
    payrollItemId: item?.id ?? '',
    assignmentId: a?.id ?? '',
    amount: '3000',
    status: 'payable',
    fundingSource: 'company',
  });
  await h.db.execute(sql`select public.refresh_payroll_item(${item?.id ?? ''})`);
  Object.assign(ids, {
    person: director?.id,
    payroll: worker?.id,
    uah: uah?.id,
    usd: usd?.id,
    period: per?.id,
    assignment: a?.id,
    item: item?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(allocation).where(inArray(allocation.transactionId, ids.transactions));
      await tx
        .delete(plannedPayment)
        .where(inArray(plannedPayment.personId, [ids.person, ids.payroll]));
      await tx.delete(plannedPayment).where(eq(plannedPayment.plannedExpenseId, ids.rule));
      await tx.delete(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    });
    await db.delete(transaction).where(inArray(transaction.id, ids.transactions));
    await db.delete(plannedExpense).where(eq(plannedExpense.id, ids.rule));
    await db.delete(paymentCharge).where(eq(paymentCharge.personId, ids.payroll));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
    await db.delete(account).where(inArray(account.id, [ids.uah, ids.usd]));
    await db.delete(fxRate).where(and(eq(fxRate.onDate, '2042-08-01'), eq(fxRate.source, 'nbu')));
    await db.delete(person).where(inArray(person.id, [ids.person, ids.payroll]));
  }),
);

const tax = (name: string, mode: 'withheld' | 'on_top', ratePercent: string) => ({
  name,
  mode,
  ratePercent,
  categoryId: cat.taxes,
  counterparty: 'ГУ ДПС',
  startsOn: '2042-08',
  feeFixed: '5',
});

const payments = async () =>
  (await listPlannedPayments.run(h.ctxFor(finance), {}))
    ._unsafeUnwrap()
    .filter((r) => r.payment.plannedExpenseId === ids.rule);
const find = async (name: string, dueOn: string) =>
  (await payments()).find((r) => r.payment.name === name && r.payment.dueOn === dueOn)?.payment;

describe('planned payments (A-082)', () => {
  it("creates the director's salary in two parts with withheld and on-top taxes", async () => {
    const saved = await savePlannedExpense.run(h.ctxFor(finance), {
      name: 'Int director salary',
      categoryId: cat.payroll,
      amount: '11401.68',
      currency: 'UAH',
      startsOn: '2042-08',
      personId: ids.person,
      parts: [
        { name: 'Advance', amount: '5500', dueDay: '22', monthOffset: '0' },
        { name: 'Rest', amount: '', dueDay: '7', monthOffset: '1' },
      ],
      charges: [
        tax('PIT', 'withheld', '18'),
        tax('Levy', 'withheld', '5'),
        tax('ESV', 'on_top', '22'),
      ],
    });
    ids.rule = saved._unsafeUnwrap().id;

    expect(await find('Advance', '2042-08-22')).toMatchObject({
      amount: '4235.00000000',
      personId: ids.person,
      status: 'due',
    });
    const rest = await find('Rest', '2042-09-07');
    expect(rest).toMatchObject({ gross: '5901.68000000', amount: '4544.30000000' });
    const charges = (await payments()).filter((r) => r.payment.parentId === rest?.id);
    expect(
      charges.map((c) => [c.payment.name, c.payment.amount, c.payment.feeAmount]).sort(),
    ).toEqual([
      ['ESV', '1298.37000000', '5.00000000'],
      ['Levy', '295.08000000', '5.00000000'],
      ['PIT', '1062.30000000', '5.00000000'],
    ]);
  });

  it("sets this month's gross by hand and keeps it when the rule changes", async () => {
    const rest = await find('Rest', '2042-09-07');
    const set = await setPlannedAmount.run(h.ctxFor(finance), {
      id: rest?.id ?? '',
      amount: '6000',
    });
    expect(set._unsafeUnwrap().amount).toBe('4620.00');
    await h.db
      .update(plannedExpense)
      .set({ amount: '12000' })
      .where(eq(plannedExpense.id, ids.rule));
    await listPlannedPayments.run(h.ctxFor(finance), {});
    expect((await find('Rest', '2042-09-07'))?.amount).toBe('4620.00000000');
    const esv = (await payments()).find(
      (r) => r.payment.parentId === rest?.id && r.payment.name === 'ESV',
    );
    expect(esv?.payment.amount).toBe('1320.00000000');
  });

  it('marks paid by a new expense or by one from a statement, and unlinks', async () => {
    const advance = await find('Advance', '2042-08-22');
    const paid = await markPlannedPaid.run(h.ctxFor(finance), {
      id: advance?.id ?? '',
      accountId: ids.uah,
      occurredOn: '2042-08-22',
    });
    ids.transactions.push(...paid._unsafeUnwrap().transactionIds);
    expect((await find('Advance', '2042-08-22'))?.status).toBe('paid');
    const [booked] = await h.db
      .select()
      .from(transaction)
      .where(eq(transaction.id, paid._unsafeUnwrap().transactionIds[0] ?? ''));
    expect(booked?.personId).toBe(ids.person);

    const pit = (await payments()).find(
      (r) => r.payment.parentId === advance?.id && r.payment.name === 'PIT',
    );
    const statement = await createTransaction.run(h.ctxFor(finance), {
      type: 'expense',
      occurredOn: '2042-08-22',
      categoryId: cat.taxes,
      description: 'ПДФО',
      from: { accountId: ids.uah, amount: '990' },
      fee: { accountId: ids.uah, amount: '5' },
    });
    const statementId = statement._unsafeUnwrap().id;
    ids.transactions.push(statementId);
    const linked = await markPlannedPaid.run(h.ctxFor(finance), {
      id: pit?.payment.id ?? '',
      transactionIds: [statementId],
    });
    expect(linked.isOk()).toBe(true);
    const again = await markPlannedPaid.run(h.ctxFor(finance), {
      id: pit?.payment.id ?? '',
      transactionIds: [statementId],
    });
    expect(again._unsafeUnwrapErr().message).toBe('planned.transactionMismatch');

    expect(
      (await deletePlannedExpense.run(h.ctxFor(finance), { id: ids.rule }))._unsafeUnwrapErr()
        .message,
    ).toBe('planned.hasPaid');
    await unlinkPlannedPayment.run(h.ctxFor(finance), { id: pit?.payment.id ?? '' });
    const after = (await payments()).find((r) => r.payment.id === pit?.payment.id);
    expect(after?.payment.status).toBe('due');
  });

  it('skips an instalment with its charges and brings it back', async () => {
    const advance = await find('Advance', '2042-09-22');
    expect(
      (
        await skipPlannedPayment.run(h.ctxFor(finance), { id: advance?.id ?? '', reason: '' })
      ).isErr(),
    ).toBe(true);
    await skipPlannedPayment.run(h.ctxFor(finance), {
      id: advance?.id ?? '',
      reason: 'Unpaid leave',
    });
    const skipped = (await payments()).filter(
      (r) => r.payment.id === advance?.id || r.payment.parentId === advance?.id,
    );
    expect(skipped.map((r) => r.payment.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    await unskipPlannedPayment.run(h.ctxFor(finance), { id: advance?.id ?? '' });
    expect((await find('Advance', '2042-09-22'))?.status).toBe('due');
  });

  it('charges 20 % in UAH at the NBU rate on every payout to a person, with the payee fee', async () => {
    const charge = await savePaymentCharge.run(h.ctxFor(finance), {
      ...tax('Tax 20 %', 'on_top', '20'),
      currency: 'UAH',
      personId: ids.payroll,
    });
    ids.personCharge = charge._unsafeUnwrap().id;
    expect(
      (
        await savePaymentCharge.run(h.ctxFor(finance), {
          ...tax('Wrong', 'withheld', '18'),
          personId: ids.payroll,
        })
      )._unsafeUnwrapErr().fieldErrors?.mode,
    ).toBeDefined();

    const paid = await payItem.run(h.ctxFor(finance), {
      itemId: ids.item,
      accountId: ids.usd,
      occurredOn: '2042-08-15',
      amount: '3000',
      feeAmount: '2297.01',
      feeAccountId: ids.uah,
    });
    const transactionId = paid._unsafeUnwrap().transactionId;
    ids.transactions.push(transactionId);
    const fees = await h.db
      .select()
      .from(posting)
      .where(and(eq(posting.transactionId, transactionId), eq(posting.isFee, true)));
    expect(fees).toMatchObject([{ amount: '-2297.01000000', currency: 'UAH' }]);
    const [payoutTax] = await h.db
      .select()
      .from(plannedPayment)
      .where(
        and(eq(plannedPayment.personId, ids.payroll), isNull(plannedPayment.plannedExpenseId)),
      );
    expect(payoutTax).toMatchObject({
      name: 'Tax 20 %',
      dueOn: '2042-08-15',
      amount: '24900.00000000',
      currency: 'UAH',
      feeAmount: '5.00000000',
      status: 'due',
    });
  });
});
