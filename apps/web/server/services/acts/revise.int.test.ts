import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditLog,
  company,
  contract,
  document,
  documentLink,
  numberSequence,
  payee,
  supplierAct,
} from '@tally/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { renderActHandler } from '../../jobs/render-act';
import { HtmlRenderer } from '../../render/renderers';
import { LocalStorage } from '../../storage/local-storage';
import { issueAct, reviseAct, saveActDraft } from '.';

const h = intHarness();
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
const SEQUENCE = `act:REV-${randomUUID().slice(0, 8)}`;
const ids = { company: '', payee: '', contract: '', act: '' };
let root = '';
const reason = 'Dates agreed with the FOP';

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  await h.db
    .insert(numberSequence)
    .values({ key: SEQUENCE, template: '9098 - А{seq}', nextValue: 3 });
  const [co] = await h.db.insert(company).values({ nameEn: 'Rev', nameUa: 'Рев' }).returning();
  const [p] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Ревізія' })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'fop',
      number: 'OD-9098',
      companyId: co?.id ?? '',
      payeeId: p?.id ?? null,
      numberSequenceKey: SEQUENCE,
    })
    .returning();
  const [a] = await h.db
    .insert(supplierAct)
    .values({
      contractId: ct?.id ?? '',
      payeeId: p?.id ?? '',
      type: 'other',
      actDate: '2091-03-30',
      periodFrom: '2091-03-01',
      periodTo: '2091-03-30',
      amountUah: '5000.00',
    })
    .returning();
  Object.assign(ids, { company: co?.id, payee: p?.id, contract: ct?.id, act: a?.id });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from public.job where payload ->> 'actId' = ${ids.act}`);
      await tx.delete(supplierAct).where(eq(supplierAct.id, ids.act));
    });
    await db.execute(
      sql`delete from public.document where id in (select document_id from public.document_link where entity_type = 'supplier_act' and entity_id = ${ids.act})`,
    );
    if (root) await rm(root, { recursive: true, force: true });
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(company).where(eq(company.id, ids.company));
    await db.delete(numberSequence).where(eq(numberSequence.key, SEQUENCE));
  }),
);

const actRow = async () =>
  (await h.db.select().from(supplierAct).where(eq(supplierAct.id, ids.act)))[0];

describe('revise an issued act (A-112)', () => {
  it('refuses to issue while the company has no requisites for the act', async () => {
    const [first] = await h.db.execute<{ id: string; legal_code: string }>(
      sql`select id, legal_code from public.company order by created_at limit 1`,
    );
    await h.db.execute(sql`update public.company set legal_code = null where id = ${first?.id}`);
    try {
      const res = await issueAct.run(h.ctxFor(finance), { id: ids.act });
      expect(res._unsafeUnwrapErr().message).toBe('company.actIncomplete');
      expect((await actRow())?.status).toBe('draft');
    } finally {
      await h.db.execute(
        sql`update public.company set legal_code = ${first?.legal_code ?? null} where id = ${first?.id}`,
      );
    }
  });

  it('issues with the dates typed in the draft form', async () => {
    await saveActDraft.run(h.ctxFor(finance), {
      id: ids.act,
      actDate: '2091-03-29',
      periodFrom: '2091-03-02',
      periodTo: '2091-03-29',
    });
    (await issueAct.run(h.ctxFor(finance), { id: ids.act }))._unsafeUnwrap();
    expect(await actRow()).toMatchObject({
      status: 'issued',
      actDate: '2091-03-29',
      periodFrom: '2091-03-02',
    });
  });

  it('changes the dates of an issued act under its number and queues a new PDF', async () => {
    await h.db
      .update(supplierAct)
      .set({ pdfFileId: 'old-file' })
      .where(eq(supplierAct.id, ids.act));
    const before = await actRow();
    expect(
      (
        await reviseAct.run(h.ctxFor(viewer), {
          id: ids.act,
          actDate: '2091-04-27',
          periodFrom: '2091-04-01',
          periodTo: '2091-04-27',
          reason,
        })
      ).isErr(),
    ).toBe(true);

    const res = await reviseAct.run(h.ctxFor(finance), {
      id: ids.act,
      actDate: '2091-04-27',
      periodFrom: '2091-04-01',
      periodTo: '2091-04-27',
      reason,
    });
    expect(res._unsafeUnwrap().number).toBe(before?.number);
    const after = await actRow();
    expect(after).toMatchObject({
      status: 'issued',
      number: before?.number,
      amountUah: '5000.00',
      actDate: '2091-04-27',
      periodFrom: '2091-04-01',
      periodTo: '2091-04-27',
      pdfFileId: null,
    });
    expect(after?.snapshot).toMatchObject({
      version: 2,
      doc: { number: before?.number, date: '27.04.2091' },
      period: { from: '01.04.2091', to: '27.04.2091' },
    });
    const audits = await h.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.rowId, ids.act), eq(auditLog.action, 'UPDATE')));
    expect(audits.some((r) => r.reason === reason)).toBe(true);
    const [job] = await h.db.execute<{ n: number }>(
      sql`select count(*)::int as n from public.job where payload ->> 'actId' = ${ids.act}`,
    );
    expect(job?.n).toBeGreaterThanOrEqual(2);
  });

  it('files the regenerated PDF as the next version of the act document (A-117)', async () => {
    root = await mkdtemp(join(tmpdir(), 'tally-revise-'));
    const render = renderActHandler({
      renderer: new HtmlRenderer(),
      storage: new LocalStorage(root),
      templateId: undefined,
    });
    await render({ actId: ids.act }, h.db);
    // A duplicate filed before versioning existed is voided too.
    const [dup] = await h.db
      .insert(document)
      .values({ type: 'act', title: 'Duplicate act PDF', number: 'dup' })
      .returning();
    await h.db
      .insert(documentLink)
      .values({ documentId: dup?.id ?? '', entityType: 'supplier_act', entityId: ids.act });
    await reviseAct.run(h.ctxFor(finance), {
      id: ids.act,
      actDate: '2091-04-27',
      periodFrom: '2091-04-01',
      periodTo: '2091-04-27',
      reason: 'Company requisites filled in',
    });
    await render({ actId: ids.act }, h.db);
    const docs = await h.db
      .select({ doc: document, links: sql<string[]>`array_agg(${documentLink.entityType})` })
      .from(document)
      .innerJoin(documentLink, eq(documentLink.documentId, document.id))
      .where(
        sql`${document.id} in (select document_id from public.document_link where entity_type = 'supplier_act' and entity_id = ${ids.act})`,
      )
      .groupBy(document.id)
      .orderBy(document.version);
    expect(docs.map((d) => [d.doc.version, d.doc.status])).toEqual([
      [1, 'void'],
      [1, 'void'],
      [2, 'issued'],
    ]);
    const current = docs[2];
    expect([docs[0]?.doc.id, docs[1]?.doc.id]).toContain(current?.doc.supersedesId);
    expect(current?.links).toContain('contract');
    expect((await actRow())?.pdfFileId).toBe(current?.doc.driveFileId);
  });

  it('keeps the year of the number, a working day and an unsigned act', async () => {
    const otherYear = await reviseAct.run(h.ctxFor(finance), {
      id: ids.act,
      actDate: '2092-01-04',
      periodFrom: '2091-12-01',
      periodTo: '2091-12-31',
      reason,
    });
    expect(otherYear._unsafeUnwrapErr().message).toBe('acts.reviseYear');
    const saturday = await reviseAct.run(h.ctxFor(finance), {
      id: ids.act,
      actDate: '2091-04-28',
      periodFrom: '2091-04-01',
      periodTo: '2091-04-28',
      reason,
    });
    expect(saturday.isErr()).toBe(true);

    await h.db
      .update(supplierAct)
      .set({ signedUrl: 'https://example.com/signed' })
      .where(eq(supplierAct.id, ids.act));
    const signed = await reviseAct.run(h.ctxFor(finance), {
      id: ids.act,
      actDate: '2091-04-27',
      periodFrom: '2091-04-01',
      periodTo: '2091-04-27',
      reason,
    });
    expect(signed._unsafeUnwrapErr().message).toBe('acts.reviseState');
  });

  it('is refused by the DB outside the revision path', async () => {
    await expect(
      h.db.execute(
        sql`update public.supplier_act set signed_url = null, act_date = '2091-04-26' where id = ${ids.act}`,
      ),
    ).rejects.toThrow();
  });
});
