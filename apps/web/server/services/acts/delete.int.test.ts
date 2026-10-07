import { randomUUID } from 'node:crypto';
import {
  auditLog,
  company,
  contract,
  document,
  documentLink,
  payee,
  payrollItem,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { deleteDraftAct } from './delete';

const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  payee: '',
  contract: '',
  document: '',
  person: '',
  period: '',
  item: '',
  acts: [] as string[],
};
const reason = 'Owner identified a mistaken standalone draft';

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Draft deletion test', nameUa: 'Тест' })
    .returning();
  const [p] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'Тест видалення' })
    .returning();
  ids.company = co?.id ?? '';
  ids.payee = p?.id ?? '';
  const [c] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: randomUUID(), companyId: ids.company, payeeId: ids.payee })
    .returning();
  ids.contract = c?.id ?? '';
  const [who] = await h.db.insert(person).values({ fullName: 'Act deletion test' }).returning();
  ids.person = who?.id ?? '';
  const [month] = await h.db
    .insert(period)
    .values({ month: '2089-06-01', workHours: '176' })
    .returning();
  ids.period = month?.id ?? '';
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: ids.period,
      personId: ids.person,
      payoutMethod: 'fiat',
      payeeId: ids.payee,
    })
    .returning();
  ids.item = item?.id ?? '';
  for (let i = 0; i < 4; i++) {
    const [a] = await h.db
      .insert(supplierAct)
      .values({
        contractId: ids.contract,
        payeeId: ids.payee,
        actDate: '2089-06-30',
        periodFrom: '2089-06-01',
        periodTo: '2089-06-30',
        amountUah: '123.45',
        type: i === 0 ? 'monthly' : 'other',
        ...(i === 1 ? ({ isLegacy: true, status: 'issued', number: randomUUID() } as const) : {}),
        ...(i === 3 ? { payrollItemId: ids.item } : {}),
      })
      .returning();
    ids.acts.push(a?.id ?? '');
  }
  const [doc] = await h.db
    .insert(document)
    .values({ type: 'act', title: 'Draft deletion linked proof' })
    .returning();
  ids.document = doc?.id ?? '';
  await h.db
    .insert(documentLink)
    .values({ documentId: ids.document, entityType: 'supplier_act', entityId: ids.acts[2] ?? '' });
});
afterAll(async () =>
  h.cleanup(async (db) => {
    await db.delete(document).where(eq(document.id, ids.document));
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(inArray(supplierAct.id, ids.acts));
    });
    await db.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('delete mistaken standalone draft act', () => {
  it('requires the owner and an audited reason', async () => {
    expect(
      (await deleteDraftAct.run(h.ctxFor(finance), { id: ids.acts[0], reason }))._unsafeUnwrapErr()
        .code,
    ).toBe('forbidden');
    expect(
      (await deleteDraftAct.run(h.systemCtx(), { id: ids.acts[0], reason }))._unsafeUnwrapErr()
        .code,
    ).toBe('forbidden');
    expect(
      (await deleteDraftAct.run(h.ctxFor(owner), { id: ids.acts[0], reason: '' })).isErr(),
    ).toBe(true);
  });
  it('previews the exact act without deleting it or writing an audit event', async () => {
    const input = { id: ids.acts[0], reason, dryRun: true };
    const result = (await deleteDraftAct.run(h.ctxFor(owner), input))._unsafeUnwrap();
    expect(result).toMatchObject({
      dryRun: true,
      deleted: {
        id: ids.acts[0],
        amountUah: '123.45',
        periodFrom: '2089-06-01',
        periodTo: '2089-06-30',
      },
    });
    expect(
      await h.db
        .select()
        .from(supplierAct)
        .where(eq(supplierAct.id, ids.acts[0] ?? '')),
    ).toHaveLength(1);
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.rowId, ids.acts[0] ?? ''), eq(auditLog.action, 'DELETE'))),
    ).toHaveLength(0);
  });
  it('refuses issued, linked, payout-backed and file-bearing drafts', async () => {
    for (const id of ids.acts.slice(1))
      expect(
        (await deleteDraftAct.run(h.ctxFor(owner), { id, reason, dryRun: true })).isErr(),
      ).toBe(true);
    await h.db
      .update(supplierAct)
      .set({ pdfFileId: 'protected-file' })
      .where(eq(supplierAct.id, ids.acts[0] ?? ''));
    expect(
      (
        await deleteDraftAct.run(h.ctxFor(owner), { id: ids.acts[0], reason, dryRun: true })
      ).isErr(),
    ).toBe(true);
    await h.db
      .update(supplierAct)
      .set({ pdfFileId: null })
      .where(eq(supplierAct.id, ids.acts[0] ?? ''));
  });
  it('deletes only the selected draft and records its old values and reason', async () => {
    expect((await deleteDraftAct.run(h.ctxFor(owner), { id: ids.acts[0], reason })).isOk()).toBe(
      true,
    );
    expect(
      await h.db
        .select()
        .from(supplierAct)
        .where(eq(supplierAct.id, ids.acts[0] ?? '')),
    ).toHaveLength(0);
    expect(
      await h.db
        .select()
        .from(supplierAct)
        .where(inArray(supplierAct.id, ids.acts.slice(1))),
    ).toHaveLength(3);
    const [audit] = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.rowId, ids.acts[0] ?? ''), eq(auditLog.action, 'DELETE')));
    expect(audit).toMatchObject({ reason, old: { status: 'draft', period_from: '2089-06-01' } });
    const [money] = await h.db.execute<{ amount: string }>(sql`
      select old ->> 'amount_uah' as amount from public.audit_log
       where row_id = ${ids.acts[0]}::uuid and action = 'DELETE'
    `);
    expect(money?.amount).toBe('123.45');
    expect(
      (await deleteDraftAct.run(h.ctxFor(owner), { id: ids.acts[0], reason }))._unsafeUnwrapErr()
        .code,
    ).toBe('not_found');
  });
});
