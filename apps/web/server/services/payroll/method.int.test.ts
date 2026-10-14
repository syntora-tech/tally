import { randomUUID } from 'node:crypto';
import {
  adjustment,
  company,
  contract,
  payee,
  payrollItem,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { changePayoutMethod } from './method';

const h = intHarness();
let finance: Awaited<ReturnType<typeof h.user>>;
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  payee: '',
  contract: '',
  people: [] as string[],
  period: '',
  item: '',
  act: '',
  adjusted: '',
  taken: '',
};

const fiatItem = (personId: string) => ({
  periodId: ids.period,
  personId,
  payoutMethod: 'fiat' as const,
  payeeId: ids.payee,
  totalUsd: '3000',
  payoutFxRate: '41.500000',
  fxSource: 'nbu' as const,
  totalUah: '124500.00',
});

beforeAll(async () => {
  finance = await h.user('finance');
  owner = await h.user('owner');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Payout method test', nameUa: 'Тест' })
    .returning();
  ids.company = co?.id ?? '';
  const [p] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Тест способу виплати' })
    .returning();
  ids.payee = p?.id ?? '';
  const [c] = await h.db
    .insert(contract)
    .values({
      kind: 'fop',
      number: `PM-${randomUUID().slice(0, 8)}`,
      companyId: ids.company,
      payeeId: ids.payee,
    })
    .returning();
  ids.contract = c?.id ?? '';
  for (const fullName of ['Method A', 'Method B', 'Method C']) {
    const [who] = await h.db.insert(person).values({ fullName }).returning();
    ids.people.push(who?.id ?? '');
  }
  const [month] = await h.db
    .insert(period)
    .values({ month: '2087-09-01', workHours: '176' })
    .returning();
  ids.period = month?.id ?? '';
  const [a, b, c2] = ids.people;
  // Entered while the month is open: a closed month freezes adjustments.
  await h.db.insert(adjustment).values({
    periodId: ids.period,
    personId: b ?? '',
    kind: 'bonus',
    amount: '100',
    currency: 'USD',
    reason: 'Bonus',
  });
  await h.db.update(period).set({ status: 'closed' }).where(eq(period.id, ids.period));

  const [item] = await h.db
    .insert(payrollItem)
    .values(fiatItem(a ?? ''))
    .returning();
  ids.item = item?.id ?? '';
  const [act] = await h.db
    .insert(supplierAct)
    .values({
      contractId: ids.contract,
      payeeId: ids.payee,
      payrollItemId: ids.item,
      actDate: '2087-09-30',
      periodFrom: '2087-09-01',
      periodTo: '2087-09-30',
      amountUah: '124500.00',
    })
    .returning();
  ids.act = act?.id ?? '';
  const [adjusted] = await h.db
    .insert(payrollItem)
    .values(fiatItem(b ?? ''))
    .returning();
  ids.adjusted = adjusted?.id ?? '';
  const [fiat] = await h.db
    .insert(payrollItem)
    .values(fiatItem(c2 ?? ''))
    .returning();
  ids.taken = fiat?.id ?? '';
  await h.db.insert(payrollItem).values({
    periodId: ids.period,
    personId: c2 ?? '',
    payoutMethod: 'bank_usd',
    payeeId: ids.payee,
    totalUsd: '10',
  });
});

afterAll(async () =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(adjustment).where(eq(adjustment.periodId, ids.period));
    });
    await db.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(person).where(inArray(person.id, ids.people));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('change payout method (A-092)', () => {
  it('is for the owner only', async () => {
    const result = await changePayoutMethod.run(h.ctxFor(finance), {
      itemId: ids.item,
      payoutMethod: 'bank_usd',
      reason: 'SWIFT',
    });
    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
  });

  it('previews without writing, then moves a closed fiat payout to USD and drops its draft act', async () => {
    const ctx = h.ctxFor(owner);
    const input = { itemId: ids.item, payoutMethod: 'bank_usd' as const, reason: 'Paid by SWIFT' };
    const preview = (await changePayoutMethod.run(ctx, { ...input, dryRun: true }))._unsafeUnwrap();
    expect(preview).toMatchObject({
      dryRun: true,
      from: 'fiat',
      to: 'bank_usd',
      deletedDraftActs: 1,
    });
    const [still] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(still?.payoutMethod).toBe('fiat');

    (await changePayoutMethod.run(ctx, input))._unsafeUnwrap();
    const [moved] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(moved).toMatchObject({
      payoutMethod: 'bank_usd',
      payoutFxRate: null,
      fxSource: null,
      totalUah: null,
      totalUsd: '3000.00000000',
    });
    const acts = await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act));
    expect(acts).toHaveLength(0);

    const again = await changePayoutMethod.run(ctx, input);
    expect(again._unsafeUnwrapErr().message).toBe('payroll.methodSame');
  });

  it('refuses a payout with adjustments of the closed month', async () => {
    const result = await changePayoutMethod.run(h.ctxFor(owner), {
      itemId: ids.adjusted,
      payoutMethod: 'crypto',
      reason: 'Crypto',
    });
    expect(result._unsafeUnwrapErr().message).toBe('payroll.methodAdjustments');
  });

  it('refuses when the month already has a payout by that method', async () => {
    const result = await changePayoutMethod.run(h.ctxFor(owner), {
      itemId: ids.taken,
      payoutMethod: 'bank_usd',
      reason: 'SWIFT',
    });
    expect(result._unsafeUnwrapErr().message).toBe('payroll.methodTaken');
  });
});
