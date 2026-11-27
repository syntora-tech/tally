import {
  adjustment,
  company,
  contract,
  fxRate,
  payee,
  payrollItem,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { adjustClosedPerson } from './closed-person';

// March 2047 is closed; nobody has a payout in it. The NBU rate of "today" is stored (no network).
const h = intHarness('2047-04-15');
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  fopPerson: '',
  cryptoPerson: '',
  payee: '',
  contract: '',
  closed: '',
  open: '',
  rate: '',
};

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'CP', nameUa: 'КП' }).returning();
  const [fopPerson, cryptoPerson] = await h.db
    .insert(person)
    .values([{ fullName: 'Closed Bonus Fop' }, { fullName: 'Closed Bonus Crypto' }])
    .returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Премія', personId: fopPerson?.id ?? null })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: fop?.id ?? null })
    .where(eq(person.id, fopPerson?.id ?? ''));
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9047', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  const [closed, open] = await h.db
    .insert(period)
    .values([
      { month: '2047-03-01', workHours: '168' },
      { month: '2047-04-01', workHours: '176' },
    ])
    .returning();
  await h.db
    .update(period)
    .set({ status: 'closed' })
    .where(eq(period.id, closed?.id ?? ''));
  const [r] = await h.db
    .insert(fxRate)
    .values({ onDate: '2047-04-15', base: 'USD', quote: 'UAH', rate: '42', source: 'nbu' })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    fopPerson: fopPerson?.id,
    cryptoPerson: cryptoPerson?.id,
    payee: fop?.id,
    contract: ct?.id,
    closed: closed?.id,
    open: open?.id,
    rate: r?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    const periods = [ids.closed, ids.open];
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(adjustment).where(inArray(adjustment.periodId, periods));
      await tx.delete(payrollItem).where(inArray(payrollItem.periodId, periods));
      await tx.delete(period).where(inArray(period.id, periods));
    });
    await db.delete(fxRate).where(eq(fxRate.id, ids.rate));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, ids.fopPerson));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(inArray(person.id, [ids.fopPerson, ids.cryptoPerson]));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const itemsOf = (personId: string) =>
  h.db
    .select()
    .from(payrollItem)
    .where(and(eq(payrollItem.periodId, ids.closed), eq(payrollItem.personId, personId)));

describe('an adjustment of a closed month for a person without a payout (A-141)', () => {
  const bonus = () => ({
    periodId: ids.closed,
    personId: ids.fopPerson,
    payoutMethod: 'fiat' as const,
    kind: 'bonus' as const,
    amount: '100',
    currency: 'USD',
    reason: 'March bonus after the close',
  });

  it('is for the owner only and only in a closed month', async () => {
    const asFinance = await adjustClosedPerson.run(h.ctxFor(finance), bonus());
    expect(asFinance._unsafeUnwrapErr().code).toBe('forbidden');
    const inOpen = await adjustClosedPerson.run(h.ctxFor(owner), {
      ...bonus(),
      periodId: ids.open,
    });
    expect(inOpen._unsafeUnwrapErr().message).toBe('payroll.adjustOpenPeriod');
  });

  it('refuses a negative amount when there is no payout', async () => {
    const result = await adjustClosedPerson.run(h.ctxFor(owner), {
      ...bonus(),
      kind: 'deduction',
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'validation_error',
      message: 'payroll.adjustNewNegative',
    });
  });

  it('previews, then creates a fiat payout at the NBU rate with a draft FOP act', async () => {
    const ctx = h.ctxFor(owner);
    const preview = (
      await adjustClosedPerson.run(ctx, { ...bonus(), dryRun: true })
    )._unsafeUnwrap();
    expect(preview).toMatchObject({ dryRun: true, created: true, totalUah: '4200.00' });
    expect(await itemsOf(ids.fopPerson)).toHaveLength(0);

    const done = (await adjustClosedPerson.run(ctx, bonus()))._unsafeUnwrap();
    const [item] = await itemsOf(ids.fopPerson);
    expect(item).toMatchObject({
      id: done.itemId,
      payeeId: ids.payee,
      payoutMethod: 'fiat',
      totalUsd: '100.00000000',
      totalUah: '4200.00',
      payoutFxRate: '42.000000',
    });
    const acts = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.payrollItemId, done.itemId));
    expect(acts).toMatchObject([
      {
        status: 'draft',
        amountUah: '4200.00',
        periodFrom: '2047-03-01',
        periodTo: '2047-03-31',
      },
    ]);
  });

  it('a second adjustment goes into that payout; its act follows', async () => {
    const ctx = h.ctxFor(owner);
    const done = (
      await adjustClosedPerson.run(ctx, {
        ...bonus(),
        kind: 'correction',
        amount: '-10',
        reason: 'Bonus is 90 USD',
      })
    )._unsafeUnwrap();
    expect(done).toMatchObject({ created: false, totalUsd: '90' });
    const items = await itemsOf(ids.fopPerson);
    expect(items).toMatchObject([{ id: done.itemId, totalUah: '3780.00' }]);
    const [act] = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.payrollItemId, done.itemId));
    expect(act?.amountUah).toBe('3780.00');
  });

  it('a crypto payout has no UAH total and no act', async () => {
    const done = (
      await adjustClosedPerson.run(h.ctxFor(owner), {
        ...bonus(),
        personId: ids.cryptoPerson,
        payoutMethod: 'crypto',
        currency: 'USDT',
        amount: '50',
      })
    )._unsafeUnwrap();
    const [item] = await itemsOf(ids.cryptoPerson);
    expect(item).toMatchObject({ id: done.itemId, totalUah: null, payeeId: null });
    const acts = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.payrollItemId, done.itemId));
    expect(acts).toHaveLength(0);
  });
});
