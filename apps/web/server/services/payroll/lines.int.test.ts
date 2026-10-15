import {
  adjustment,
  assignment,
  company,
  contract,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { splitActByActivity } from '../acts';
import { adjustClosedPayout, removePayoutLine } from './lines';

const h = intHarness('2045-11-10');
let finance: Awaited<ReturnType<typeof h.user>>;
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  assignments: [] as string[],
  period: '',
  item: '',
  act: '',
  usdLine: '',
  salaryLine: '',
};

beforeAll(async () => {
  finance = await h.user('finance');
  owner = await h.user('owner');
  const [co] = await h.db.insert(company).values({ nameEn: 'Lines', nameUa: 'Рядки' }).returning();
  ids.company = co?.id ?? '';
  const [p] = await h.db.insert(person).values({ fullName: 'Lines Director' }).returning();
  ids.person = p?.id ?? '';
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Рядки', personId: ids.person })
    .returning();
  ids.payee = fop?.id ?? '';
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9045', companyId: ids.company, payeeId: ids.payee })
    .returning();
  ids.contract = ct?.id ?? '';
  for (const roleTitle of ['CTO', 'Директор']) {
    const [a] = await h.db
      .insert(assignment)
      .values({ personId: ids.person, isInternal: true, roleTitle, startsOn: '2045-01-01' })
      .returning();
    ids.assignments.push(a?.id ?? '');
  }
  const [per] = await h.db
    .insert(period)
    .values({ month: '2045-10-01', workHours: '184', status: 'closed' })
    .returning();
  ids.period = per?.id ?? '';
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: ids.period,
      personId: ids.person,
      payoutMethod: 'fiat',
      payeeId: ids.payee,
      totalUsd: '1000',
      payoutFxRate: '40.000000',
      fxSource: 'manual',
      totalUah: '48780.00',
    })
    .returning();
  ids.item = item?.id ?? '';
  const [usd, uah] = await h.db
    .insert(payrollLine)
    .values([
      {
        payrollItemId: ids.item,
        assignmentId: ids.assignments[0] ?? '',
        amount: '1000',
        currency: 'USD',
        status: 'payable',
        fundingSource: 'company',
      },
      {
        payrollItemId: ids.item,
        assignmentId: ids.assignments[1] ?? '',
        amount: '8780',
        currency: 'UAH',
        status: 'payable',
        fundingSource: 'company',
      },
    ])
    .returning();
  ids.usdLine = usd?.id ?? '';
  ids.salaryLine = uah?.id ?? '';
  const [act] = await h.db
    .insert(supplierAct)
    .values({
      contractId: ids.contract,
      payeeId: ids.payee,
      payrollItemId: ids.item,
      actDate: '2045-10-31',
      periodFrom: '2045-10-01',
      periodTo: '2045-10-31',
      amountUah: '48780.00',
    })
    .returning();
  ids.act = act?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(adjustment).where(eq(adjustment.periodId, ids.period));
      await tx.delete(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
      await tx.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
    });
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(assignment).where(inArray(assignment.id, ids.assignments));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('a line out of a closed payout (A-097)', () => {
  it('is for the owner only', async () => {
    const result = await removePayoutLine.run(h.ctxFor(finance), {
      lineId: ids.salaryLine,
      reason: 'Paid by plan',
    });
    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
  });

  it('previews, then removes the salary line; the payout and its draft act follow', async () => {
    const ctx = h.ctxFor(owner);
    const input = { lineId: ids.salaryLine, reason: 'Director salary is paid by plan' };
    const preview = (await removePayoutLine.run(ctx, { ...input, dryRun: true }))._unsafeUnwrap();
    expect(preview).toMatchObject({ dryRun: true, totalUah: '40000.00', itemDeleted: false });
    const lines = () =>
      h.db.select().from(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
    expect(await lines()).toHaveLength(2);

    (await removePayoutLine.run(ctx, input))._unsafeUnwrap();
    expect((await lines()).map((l) => l.id)).toEqual([ids.usdLine]);
    const [item] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(item).toMatchObject({ totalUsd: '1000.00000000', totalUah: '40000.00' });
    const [act] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act));
    expect(act?.amountUah).toBe('40000.00');
  });

  it('the owner corrects the closed payout by an adjustment; the draft act follows (A-099)', async () => {
    const input = { itemId: ids.item, amount: '-0.27', reason: 'CTO is 803.73 USD' };
    expect((await adjustClosedPayout.run(h.ctxFor(finance), input))._unsafeUnwrapErr().code).toBe(
      'forbidden',
    );
    const ctx = h.ctxFor(owner);
    const preview = (await adjustClosedPayout.run(ctx, { ...input, dryRun: true }))._unsafeUnwrap();
    expect(preview).toMatchObject({ dryRun: true, totalUah: '39989.20' });
    (await adjustClosedPayout.run(ctx, input))._unsafeUnwrap();
    const [item] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(item).toMatchObject({ totalUsd: '999.73000000', totalUah: '39989.20' });
    const [act] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act));
    expect(act?.amountUah).toBe('39989.20');
    const added = await h.db.select().from(adjustment).where(eq(adjustment.periodId, ids.period));
    expect(added).toMatchObject([{ kind: 'correction', amount: '-0.27000000', currency: 'USD' }]);
  });

  it('an adjustment of the closed month moves into a split act; its amount stays frozen', async () => {
    const added = await adjustClosedPayout.run(h.ctxFor(owner), {
      itemId: ids.item,
      kind: 'other',
      amount: '2644',
      currency: 'UAH',
      reason: 'AWS',
    });
    const correction = { id: added._unsafeUnwrap().adjustmentId };
    const split = await splitActByActivity.run(h.ctxFor(finance), {
      actId: ids.act,
      adjustmentIds: [correction.id ?? ''],
      periodFrom: '2045-10-01',
      periodTo: '2045-10-15',
    });
    const newAct = split._unsafeUnwrap().id;
    const [moved] = await h.db
      .select()
      .from(adjustment)
      .where(eq(adjustment.id, correction.id ?? ''));
    expect(moved?.supplierActId).toBe(newAct);
    await expect(
      h.db
        .update(adjustment)
        .set({ amount: '-1' })
        .where(eq(adjustment.id, correction.id ?? '')),
    ).rejects.toThrow();
  });

  it('refuses once the act is issued', async () => {
    await h.db
      .update(supplierAct)
      .set({ status: 'issued', number: 'LN - А1', snapshot: {} })
      .where(eq(supplierAct.id, ids.act));
    const result = await removePayoutLine.run(h.ctxFor(owner), {
      lineId: ids.usdLine,
      reason: 'Test',
    });
    expect(result._unsafeUnwrapErr().message).toBe('payroll.lineActIssued');
    const adjusted = await adjustClosedPayout.run(h.ctxFor(owner), {
      itemId: ids.item,
      amount: '1',
      reason: 'Test',
    });
    expect(adjusted._unsafeUnwrapErr().message).toBe('payroll.lineActIssued');
  });
});
