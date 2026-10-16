import { randomUUID } from 'node:crypto';
import {
  auditLog,
  company,
  contract,
  payee,
  payrollItem,
  period,
  supplierAct,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { createRestAct, restoreAct, voidAct } from '.';

const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  payee: '',
  contract: '',
  period: '',
  item: '',
  act: '',
  other: '',
  period2: '',
  item2: '',
};
const reason = 'Voided by mistake';

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Act restore test', nameUa: 'Тест' })
    .returning();
  const [p] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'Тест відновлення' })
    .returning();
  ids.company = co?.id ?? '';
  ids.payee = p?.id ?? '';
  const [c] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: randomUUID(), companyId: ids.company, payeeId: ids.payee })
    .returning();
  ids.contract = c?.id ?? '';
  const [month] = await h.db
    .insert(period)
    .values({ month: '2091-03-01', workHours: '160' })
    .returning();
  ids.period = month?.id ?? '';
  const [item] = await h.db
    .insert(payrollItem)
    .values({ periodId: ids.period, kind: 'agency', payoutMethod: 'fiat', payeeId: ids.payee })
    .returning();
  ids.item = item?.id ?? '';
  const [a] = await h.db
    .insert(supplierAct)
    .values({
      contractId: ids.contract,
      payeeId: ids.payee,
      payrollItemId: ids.item,
      type: 'monthly',
      actDate: '2091-03-30',
      periodFrom: '2091-03-01',
      periodTo: '2091-03-31',
      amountUah: '1000.00',
      isLegacy: true,
      status: 'issued',
      number: randomUUID(),
      signedUrl: 'https://example.com/signed',
    })
    .returning();
  ids.act = a?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.payrollItemId, ids.item));
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      if (ids.item2) await tx.delete(supplierAct).where(eq(supplierAct.payrollItemId, ids.item2));
    });
    await db
      .delete(payrollItem)
      .where(inArray(payrollItem.id, [ids.item, ids.item2].filter(Boolean)));
    await db.delete(period).where(inArray(period.id, [ids.period, ids.period2].filter(Boolean)));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const actRow = async () =>
  (await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act)))[0];

describe('restore a void act (A-111)', () => {
  it('brings a mistakenly voided act back as issued, owner only, with an audited reason', async () => {
    const before = await actRow();
    await voidAct.run(h.ctxFor(owner), { id: ids.act, reason: 'Wrong click' });
    expect((await actRow())?.status).toBe('void');

    const denied = await restoreAct.run(h.ctxFor(finance), { id: ids.act, reason });
    expect(denied._unsafeUnwrapErr().code).toBe('forbidden');

    (await restoreAct.run(h.ctxFor(owner), { id: ids.act, reason }))._unsafeUnwrap();
    expect(await actRow()).toMatchObject({
      status: 'issued',
      voidReason: null,
      number: before?.number,
      amountUah: '1000.00',
      signedUrl: 'https://example.com/signed',
    });
    const audits = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.rowId, ids.act), eq(auditLog.action, 'UPDATE')));
    expect(audits.some((r) => r.reason === reason)).toBe(true);

    const again = await restoreAct.run(h.ctxFor(owner), { id: ids.act, reason });
    expect(again._unsafeUnwrapErr().message).toBe('acts.restoreState');
  });

  it('refuses when another act of the payout already took its days', async () => {
    await voidAct.run(h.ctxFor(owner), { id: ids.act, reason: 'Replaced' });
    const [other] = await h.db
      .insert(supplierAct)
      .values({
        contractId: ids.contract,
        payeeId: ids.payee,
        payrollItemId: ids.item,
        type: 'monthly',
        actDate: '2091-03-30',
        periodFrom: '2091-03-01',
        periodTo: '2091-03-31',
        amountUah: '1000.00',
      })
      .returning();
    ids.other = other?.id ?? '';
    const res = await restoreAct.run(h.ctxFor(owner), { id: ids.act, reason });
    expect(res.isErr()).toBe(true);
    expect((await actRow())?.status).toBe('void');
  });

  it('keeps the other direction closed: a draft never becomes void-restored', async () => {
    const res = await restoreAct.run(h.ctxFor(owner), { id: ids.other, reason });
    expect(res._unsafeUnwrapErr().message).toBe('acts.restoreState');
  });

  it('makes a new act of the rest after the paid acts once the old one is gone', async () => {
    const [month] = await h.db
      .insert(period)
      .values({ month: '2091-05-01', workHours: '160' })
      .returning();
    ids.period2 = month?.id ?? '';
    const [item] = await h.db
      .insert(payrollItem)
      .values({
        periodId: ids.period2,
        kind: 'agency',
        payoutMethod: 'fiat',
        payeeId: ids.payee,
        payoutFxRate: '40',
        fxSource: 'manual',
        totalUah: '3000',
      })
      .returning();
    ids.item2 = item?.id ?? '';
    await h.db.insert(supplierAct).values({
      contractId: ids.contract,
      payeeId: ids.payee,
      payrollItemId: ids.item2,
      type: 'monthly',
      actDate: '2091-05-31',
      periodFrom: '2091-05-01',
      periodTo: '2091-05-31',
      amountUah: '1000.00',
      amountUsd: '25',
      fxRate: '40',
      fxSource: 'manual',
      rateLocked: true,
      isLegacy: true,
      status: 'issued',
      number: randomUUID(),
    });

    const [paid] = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.payrollItemId, ids.item2));
    await voidAct.run(h.ctxFor(owner), { id: paid?.id ?? '', reason: 'Oops' });
    const blocked = await createRestAct.run(h.ctxFor(finance), { itemId: ids.item2 });
    expect(blocked._unsafeUnwrapErr().message).toContain(paid?.number ?? '');
    await restoreAct.run(h.ctxFor(owner), { id: paid?.id ?? '', reason });

    const made = (
      await createRestAct.run(h.ctxFor(finance), { itemId: ids.item2 })
    )._unsafeUnwrap();
    const [rest] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, made.id));
    expect(rest).toMatchObject({
      status: 'draft',
      amountUsd: null,
      amountUah: '2000.00',
      periodFrom: '2091-06-01',
      periodTo: '2091-06-01',
    });
    const twice = await createRestAct.run(h.ctxFor(finance), { itemId: ids.item2 });
    expect(twice._unsafeUnwrapErr().message).toBe('acts.restActExists');
  });
});
