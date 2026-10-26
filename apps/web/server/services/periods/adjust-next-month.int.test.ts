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
import { addAdjustment } from '.';

// September 2051 is closed and paid; its last act runs into October (A-098), October is open.
const h = intHarness('2051-10-20');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = { company: '', person: '', payee: '', contract: '', periods: [] as string[], item: '' };

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'Next', nameUa: 'Далі' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Next Month Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Далі', personId: p?.id ?? null })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: fop?.id ?? null })
    .where(eq(person.id, p?.id ?? ''));
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9051', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  Object.assign(ids, { company: co?.id, person: p?.id, payee: fop?.id, contract: ct?.id });
  for (const month of ['2051-09-01', '2051-10-01']) {
    const [per] = await h.db.insert(period).values({ month, workHours: '176' }).returning();
    ids.periods.push(per?.id ?? '');
  }
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: ids.periods[0] ?? '',
      personId: ids.person,
      payoutMethod: 'fiat',
      payeeId: ids.payee,
      totalUsd: '4000',
    })
    .returning();
  ids.item = item?.id ?? '';
  await h.db.insert(supplierAct).values({
    contractId: ids.contract,
    payeeId: ids.payee,
    payrollItemId: ids.item,
    type: 'monthly',
    actDate: '2051-10-19',
    periodFrom: '2051-10-01',
    periodTo: '2051-10-19',
    amountUah: '178920.00',
  });
  await h.db
    .update(supplierAct)
    .set({ status: 'issued', number: 'OD-9051 - А12', snapshot: {} })
    .where(eq(supplierAct.payrollItemId, ids.item));
  await h.db
    .update(period)
    .set({ status: 'closed' })
    .where(eq(period.id, ids.periods[0] ?? ''));
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(adjustment).where(inArray(adjustment.periodId, ids.periods));
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    });
    await db.delete(period).where(inArray(period.id, ids.periods));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, ids.person));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('adjustments of a month after the previous payout ran into it (A-098)', () => {
  const add = () =>
    addAdjustment.run(h.ctxFor(finance), {
      periodId: ids.periods[1] ?? '',
      personId: ids.person,
      kind: 'other',
      amount: '1828',
      currency: 'USD',
      reason: 'Compensation: corporate services',
    });

  it('ignores the issued September act dated in October', async () => {
    expect((await add()).isOk()).toBe(true);
  });

  it('still refuses once an October act of the person is issued', async () => {
    await h.db.insert(supplierAct).values({
      contractId: ids.contract,
      payeeId: ids.payee,
      type: 'monthly',
      actDate: '2051-10-31',
      periodFrom: '2051-10-20',
      periodTo: '2051-10-31',
      amountUah: '1000.00',
    });
    await h.db
      .update(supplierAct)
      .set({ status: 'issued', number: 'OD-9051 - А13', snapshot: {} })
      .where(eq(supplierAct.periodFrom, '2051-10-20'));
    expect((await add())._unsafeUnwrapErr().message).toBe(
      'periods.adjustmentActed|{"number":"OD-9051 - А13"}',
    );
  });
});
