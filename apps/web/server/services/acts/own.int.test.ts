import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  account,
  assignment,
  company,
  contract,
  document,
  documentLink,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { LocalStorage } from '../../storage/local-storage';
import { payItem } from '../payroll';
import { attachSignedAct, issueActWithDocument } from './own';

const storage = vi.hoisted(() => ({ root: '' }));
vi.mock('../../storage', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDocumentStorage: () => new LocalStorage(storage.root),
}));

// An act made outside Tally, then its signed copy (A-101).
const h = intHarness('2047-11-05');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  assignment: '',
  period: '',
  item: '',
  act: '',
  other: '',
  account: '',
};
const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' });

beforeAll(async () => {
  storage.root = await mkdtemp(join(tmpdir(), 'tally-own-act-'));
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'Own act', nameUa: 'Свій' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Own Act Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Свій', personId: p?.id ?? null })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9047', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2047-01-01' })
    .returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2047-10-01', workHours: '184', status: 'closed' })
    .returning();
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: per?.id ?? '',
      personId: p?.id ?? '',
      payoutMethod: 'fiat',
      payeeId: fop?.id ?? null,
      totalUsd: '1000',
      payoutFxRate: '40.000000',
      fxSource: 'manual',
      totalUah: '40000.00',
    })
    .returning();
  await h.db.insert(payrollLine).values({
    payrollItemId: item?.id ?? '',
    assignmentId: a?.id ?? '',
    amount: '1000',
    status: 'payable',
    fundingSource: 'company',
  });
  await h.db.execute(sql`select public.refresh_payroll_item(${item?.id ?? ''})`);
  const act = (periodFrom: string, periodTo: string) => ({
    contractId: ct?.id ?? '',
    payeeId: fop?.id ?? '',
    actDate: '2047-10-31',
    periodFrom,
    periodTo,
    amountUah: '40000.00',
  });
  const [main] = await h.db
    .insert(supplierAct)
    .values({ ...act('2047-10-01', '2047-10-31'), payrollItemId: item?.id ?? null })
    .returning();
  const [other] = await h.db
    .insert(supplierAct)
    .values({ ...act('2047-09-01', '2047-09-30'), type: 'other' })
    .returning();
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `Own act UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2047-01-01',
    })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    person: p?.id,
    payee: fop?.id,
    contract: ct?.id,
    assignment: a?.id,
    period: per?.id,
    item: item?.id,
    act: main?.id,
    other: other?.id,
    account: acc?.id,
  });
});

afterAll(async () => {
  await h.cleanup(async (db) => {
    const links = await db
      .select({ id: documentLink.documentId })
      .from(documentLink)
      .where(eq(documentLink.entityId, ids.act));
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.allocation where payroll_item_id = ${ids.item}`);
      const txIds = await tx.execute<{ id: string }>(
        sql`select distinct transaction_id as id from public.posting where account_id = ${ids.account}`,
      );
      await tx.execute(
        sql`delete from public.posting where transaction_id in (select transaction_id from public.posting where account_id = ${ids.account})`,
      );
      for (const { id } of txIds) {
        await tx.execute(sql`delete from public.transaction where id = ${id}`);
      }
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      if (links.length) {
        const docIds = links.map((l) => l.id);
        await tx.delete(documentLink).where(inArray(documentLink.documentId, docIds));
        await tx.delete(document).where(inArray(document.id, docIds));
      }
      await tx.delete(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    });
    await db.delete(account).where(eq(account.id, ids.account));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  });
  await rm(storage.root, { recursive: true, force: true });
});

const pay = () =>
  payItem.run(h.ctxFor(finance), {
    itemId: ids.item,
    accountId: ids.account,
    occurredOn: '2047-11-05',
    amount: '40000',
  });

describe('an act with a document made outside Tally (A-101)', () => {
  it('issues the act with the typed number and the uploaded PDF, no render', async () => {
    const result = await issueActWithDocument.run(h.ctxFor(finance), {
      id: ids.act,
      number: '9047 - А7',
      actDate: '2047-10-31',
      file: pdf('act.pdf'),
    });
    expect(result._unsafeUnwrap()).toMatchObject({ number: '9047 - А7' });
    const [act] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act));
    expect(act).toMatchObject({ status: 'issued', number: '9047 - А7', gdocFileId: null });
    expect(act?.pdfFileId).toBeTruthy();
    expect((await pay())._unsafeUnwrapErr().message).toBe('payroll.actNotSigned');
  });

  it('refuses a number another act of the contract has, and a non-PDF', async () => {
    const taken = await issueActWithDocument.run(h.ctxFor(finance), {
      id: ids.other,
      number: '9047 - А7',
      actDate: '2047-10-30',
      file: pdf('other.pdf'),
    });
    expect(taken._unsafeUnwrapErr().message).toBe('acts.numberTaken');
    const notPdf = await issueActWithDocument.run(h.ctxFor(finance), {
      id: ids.other,
      number: '9047 - А8',
      actDate: '2047-10-30',
      file: new File(['x'], 'act.docx'),
    });
    expect(notPdf._unsafeUnwrapErr().fieldErrors?.file).toBeDefined();
  });

  it('a signed copy uploaded later lets the payout be paid', async () => {
    (
      await attachSignedAct.run(h.ctxFor(finance), { id: ids.act, file: pdf('signed.pdf') })
    )._unsafeUnwrap();
    const [act] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act));
    expect(act?.signedDocumentId).toBeTruthy();
    expect((await pay()).isOk()).toBe(true);
  });
});
