import { randomUUID } from 'node:crypto';
import {
  assignment,
  company,
  contract,
  document,
  documentLink,
  numberSequence,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { setDefaultPayee } from '../payees';
import { payoutPayees, setPayoutPayee } from './payee';

const h = intHarness();
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
let owner: Awaited<ReturnType<typeof h.user>>;
const NUMBER = `PT-${randomUUID().slice(0, 6)}`;
const ids = {
  company: '',
  person: '',
  fop: '',
  bare: '',
  contract: '',
  period: '',
  item: '',
  assignment: '',
  period2: '',
  item2: '',
  doc: '',
};

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  owner = await h.user('owner');
  const [co] = await h.db.insert(company).values({ nameEn: 'Payee', nameUa: 'Одерж' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'No payee yet' }).returning();
  const [fop, bare] = await h.db
    .insert(payee)
    .values([
      { kind: 'fop', legalNameUa: 'ФОП З договором' },
      { kind: 'fop', legalNameUa: 'ФОП Без договору' },
    ])
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'fop',
      number: randomUUID(),
      companyId: co?.id ?? '',
      payeeId: fop?.id ?? null,
    })
    .returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2093-02-01', workHours: '160' })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2093-01-01' })
    .returning();
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: per?.id ?? '',
      personId: p?.id ?? '',
      payoutMethod: 'fiat',
      totalUsd: '100',
      payoutFxRate: '40',
      fxSource: 'manual',
      totalUah: '4000',
    })
    .returning();
  await h.db.insert(payrollLine).values({
    payrollItemId: item?.id ?? '',
    assignmentId: a?.id ?? '',
    amount: '100',
    status: 'payable',
    fundingSource: 'company',
  });
  const [doc] = await h.db
    .insert(document)
    .values({ type: 'contract', number: NUMBER, docDate: '2093-01-10', title: `Договір ${NUMBER}` })
    .returning();
  await h.db
    .insert(documentLink)
    .values({ documentId: doc?.id ?? '', entityType: 'payee', entityId: bare?.id ?? '' });
  Object.assign(ids, {
    doc: doc?.id,
    company: co?.id,
    person: p?.id,
    fop: fop?.id,
    bare: bare?.id,
    contract: ct?.id,
    period: per?.id,
    item: item?.id,
    assignment: a?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const items = [ids.item, ids.item2].filter(Boolean);
      await tx.delete(supplierAct).where(inArray(supplierAct.payrollItemId, items));
      await tx.delete(payrollLine).where(inArray(payrollLine.payrollItemId, items));
      await tx.delete(payrollItem).where(inArray(payrollItem.id, items));
    });
    await db.delete(period).where(inArray(period.id, [ids.period, ids.period2].filter(Boolean)));
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, ids.person));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(contract).where(eq(contract.payeeId, ids.bare));
    await db.delete(documentLink).where(eq(documentLink.documentId, ids.doc));
    await db.delete(document).where(eq(document.id, ids.doc));
    await db.delete(numberSequence).where(eq(numberSequence.key, `act:${NUMBER}`));
    await db.delete(payee).where(inArray(payee.id, [ids.fop, ids.bare]));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('recipient of a payout chosen after the close (A-113)', () => {
  it('refuses a viewer and a FOP without a contract', async () => {
    const asViewer = await setPayoutPayee.run(h.ctxFor(viewer), {
      itemId: ids.item,
      payeeId: ids.fop,
    });
    expect(asViewer._unsafeUnwrapErr().code).toBe('forbidden');
    const bare = await setPayoutPayee.run(h.ctxFor(finance), {
      itemId: ids.item,
      payeeId: ids.bare,
    });
    expect(bare._unsafeUnwrapErr().message).toBe('payroll.payeeNoContract');
    const [item] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(item?.payeeId).toBeNull();
  });

  it('creates the contract and act numbering of a FOP without one, then its draft act', async () => {
    const before = (await payoutPayees.run(h.ctxFor(finance), {}))._unsafeUnwrap();
    expect(before.find((p) => p.id === ids.bare)).toMatchObject({
      fop: true,
      hasContract: false,
      contractDoc: { number: NUMBER, date: '2093-01-10' },
    });
    expect(before.find((p) => p.id === ids.fop)).toMatchObject({ hasContract: true });

    const byFinance = await setPayoutPayee.run(h.ctxFor(finance), {
      itemId: ids.item,
      payeeId: ids.bare,
      contractNumber: NUMBER,
    });
    expect(byFinance._unsafeUnwrapErr().message).toBe('payroll.contractOwnerOnly');

    const res = await setPayoutPayee.run(h.ctxFor(owner), {
      itemId: ids.item,
      payeeId: ids.bare,
      remember: 'on',
      contractNumber: NUMBER,
      contractSignedOn: '2093-01-15',
    });
    const { actId } = res._unsafeUnwrap();
    const [item] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(item?.payeeId).toBe(ids.bare);
    const [who] = await h.db.select().from(person).where(eq(person.id, ids.person));
    expect(who?.defaultPayeeId).toBe(ids.bare);
    const [made] = await h.db.select().from(contract).where(eq(contract.payeeId, ids.bare));
    expect(made).toMatchObject({
      kind: 'fop',
      number: NUMBER,
      signedOn: '2093-01-15',
      currency: 'UAH',
      numberSequenceKey: `act:${NUMBER}`,
    });
    const filed = await h.db
      .select()
      .from(documentLink)
      .where(and(eq(documentLink.documentId, ids.doc), eq(documentLink.entityType, 'contract')));
    expect(filed.map((l) => l.entityId)).toEqual([made?.id]);
    const [seq] = await h.db
      .select()
      .from(numberSequence)
      .where(eq(numberSequence.key, `act:${NUMBER}`));
    expect(seq).toMatchObject({ template: `${NUMBER} - А{seq}`, nextValue: 1 });
    const [act] = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.id, actId ?? ''));
    expect(act).toMatchObject({
      status: 'draft',
      payeeId: ids.bare,
      contractId: made?.id,
      amountUah: '4000.00',
      periodFrom: '2093-02-01',
      periodTo: '2093-02-28',
    });

    const again = await setPayoutPayee.run(h.ctxFor(finance), {
      itemId: ids.item,
      payeeId: ids.fop,
    });
    expect(again._unsafeUnwrapErr().message).toBe('payroll.payeeHasAct');
  });

  it('fills open payouts without a recipient when the person gets a default later (A-114)', async () => {
    const [per] = await h.db
      .insert(period)
      .values({ month: '2093-03-01', workHours: '160' })
      .returning();
    const [item] = await h.db
      .insert(payrollItem)
      .values({
        periodId: per?.id ?? '',
        personId: ids.person,
        payoutMethod: 'fiat',
        totalUsd: '50',
        payoutFxRate: '40',
        fxSource: 'manual',
        totalUah: '2000',
      })
      .returning();
    Object.assign(ids, { period2: per?.id, item2: item?.id });

    (
      await setDefaultPayee.run(h.ctxFor(finance), { personId: ids.person, payeeId: ids.fop })
    )._unsafeUnwrap();
    const [filled] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item2));
    expect(filled?.payeeId).toBe(ids.fop);
    const acts = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.payrollItemId, ids.item2));
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({
      status: 'draft',
      contractId: ids.contract,
      amountUah: '2000.00',
    });
    const [kept] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item));
    expect(kept?.payeeId).toBe(ids.bare);

    await setDefaultPayee.run(h.ctxFor(finance), { personId: ids.person, payeeId: ids.bare });
    const [still] = await h.db.select().from(payrollItem).where(eq(payrollItem.id, ids.item2));
    expect(still?.payeeId).toBe(ids.fop);
  });
});
