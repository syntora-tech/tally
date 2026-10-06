import { randomUUID } from 'node:crypto';
import {
  client,
  company,
  contract,
  document,
  documentLink,
  invoice,
  invoiceNumberCorrection,
  invoiceRevision,
  numberSequence,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness, purgeProtected } from '../../../test/int-helpers';
import { inActorScope } from '../context';
import { reconcileInvoiceNumbers } from './reconcile';

const h = intHarness('2037-08-03');
const prefix = `SIGNED-${randomUUID()}`;
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  client: '',
  contract: '',
  invoices: [] as string[],
  docs: [] as string[],
};
const reason = 'Owner verified signed originals';
const items = () =>
  ids.invoices.map((invoiceId, i) => ({
    invoiceId,
    signedDocumentId: ids.docs[i],
    expectedNumber: `${prefix}-${i}`,
    number: `${prefix}-${(i + 1) % 3}`,
    signedTotal: '100',
    signedCurrency: 'USD',
  }));

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Signed test', nameUa: 'Тест' })
    .returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Signed test client' }).returning();
  await h.db.insert(numberSequence).values({ key: prefix, template: '{seq}/{yy}', nextValue: 50 });
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'client',
      number: prefix,
      companyId: co?.id ?? '',
      clientId: cl?.id ?? '',
      numberSequenceKey: prefix,
    })
    .returning();
  Object.assign(ids, { company: co?.id ?? '', client: cl?.id ?? '', contract: ct?.id ?? '' });
  for (let i = 0; i < 3; i++) {
    const [inv] = await h.db
      .insert(invoice)
      .values({
        clientId: ids.client,
        contractId: ids.contract,
        issueDate: '2037-08-03',
        dueDate: '2037-08-20',
        status: 'issued',
        number: `${prefix}-${i}`,
        total: '100',
        snapshot: {
          doc: { number: `${prefix}-${i}`, date: '03.08.2037' },
          revision: 1,
          lines: [],
          total: { amount: '100' },
        },
        pdfFileId: `generated-${i}`,
      })
      .returning();
    ids.invoices.push(inv?.id ?? '');
    const [doc] = await h.db
      .insert(document)
      .values({
        type: 'invoice',
        title: `Invoice ${prefix}-${i} (signed)`,
        number: `${prefix}-${i}`,
        status: 'issued',
        driveFileId: `signed-${i}`,
        signedAt: new Date('2037-08-03T12:00:00Z'),
        sourceRevision: 1,
      })
      .returning();
    ids.docs.push(doc?.id ?? '');
    await h.db
      .insert(documentLink)
      .values({ documentId: doc?.id ?? '', entityType: 'invoice', entityId: inv?.id ?? '' });
  }
});

afterAll(async () =>
  h.cleanup(async (db) => {
    await db
      .delete(invoiceNumberCorrection)
      .where(inArray(invoiceNumberCorrection.invoiceId, ids.invoices));
    await db.delete(document).where(inArray(document.id, ids.docs));
    await purgeProtected(db, { invoiceIds: ids.invoices });
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(numberSequence).where(eq(numberSequence.key, prefix));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('signed invoice number reconciliation', () => {
  it('only owners may reconcile, including dry runs', async () => {
    const result = await reconcileInvoiceNumbers.run(h.ctxFor(finance), {
      invoices: items(),
      reason,
      dryRun: true,
    });
    expect(result._unsafeUnwrapErr().code).toBe('forbidden');
    await expect(
      inActorScope(h.ctxFor(finance), (tx) =>
        tx.execute(
          sql`select public.reconcile_invoice_numbers(${JSON.stringify(items())}::jsonb, ${reason})`,
        ),
      ),
    ).rejects.toThrow();
  });
  it('previews atomic cyclic swaps and rolls back documents, revisions and correction history', async () => {
    expect(
      (
        await reconcileInvoiceNumbers.run(h.ctxFor(owner), {
          invoices: items(),
          reason,
          dryRun: true,
        })
      )._unsafeUnwrap().invoices,
    ).toHaveLength(3);
    expect(
      (await h.db.select().from(invoice).where(inArray(invoice.id, ids.invoices))).every(
        (i) => i.revision === 1,
      ),
    ).toBe(true);
    expect(
      await h.db
        .select()
        .from(invoiceNumberCorrection)
        .where(inArray(invoiceNumberCorrection.invoiceId, ids.invoices)),
    ).toHaveLength(0);
    expect(
      (await h.db.select().from(document).where(inArray(document.id, ids.docs))).every(
        (d) => d.sourceRevision === 1,
      ),
    ).toBe(true);
  });
  it('rejects stale numbers, mismatched totals, non-current or unsigned copies and target collisions', async () => {
    const input = items();
    for (const patch of [
      { expectedNumber: 'stale' },
      { signedTotal: '101' },
      { signedDocumentId: ids.docs[1] },
    ]) {
      expect(
        (
          await reconcileInvoiceNumbers.run(h.ctxFor(owner), {
            invoices: [{ ...input[0], ...patch }],
            reason,
            dryRun: true,
          })
        ).isErr(),
      ).toBe(true);
    }
    expect(
      (
        await reconcileInvoiceNumbers.run(h.ctxFor(owner), {
          invoices: [input[0]],
          reason,
          dryRun: true,
        })
      )._unsafeUnwrapErr().code,
    ).toBe('conflict');
    await h.db
      .update(document)
      .set({ signedAt: null })
      .where(eq(document.id, ids.docs[0] ?? ''));
    expect(
      (
        await reconcileInvoiceNumbers.run(h.ctxFor(owner), {
          invoices: input,
          reason,
          dryRun: true,
        })
      ).isErr(),
    ).toBe(true);
    await h.db
      .update(document)
      .set({ signedAt: new Date('2037-08-03T12:00:00Z') })
      .where(eq(document.id, ids.docs[0] ?? ''));
  });
  it('keeps ordinary number edits and fabricated authorization records forbidden', async () => {
    await expect(
      inActorScope(h.ctxFor(owner), (tx) =>
        tx
          .update(invoice)
          .set({ number: 'unauthorized' })
          .where(eq(invoice.id, ids.invoices[0] ?? '')),
      ),
    ).rejects.toThrow();
    await expect(
      inActorScope(h.ctxFor(owner), (tx) =>
        tx.insert(invoiceNumberCorrection).values({
          invoiceId: ids.invoices[0] ?? '',
          signedDocumentId: ids.docs[0] ?? '',
          oldNumber: `${prefix}-0`,
          newNumber: 'fake',
          reason,
        }),
      ),
    ).rejects.toThrow();
  });
  it('commits a swap, preserves files and amounts, and retains old numbers with evidence', async () => {
    const input = items();
    const result = (
      await reconcileInvoiceNumbers.run(h.ctxFor(owner), { invoices: input, reason })
    )._unsafeUnwrap();
    expect(result.invoices).toHaveLength(3);
    for (const [i, item] of input.entries()) {
      const [inv] = await h.db.select().from(invoice).where(eq(invoice.id, item.invoiceId));
      expect(inv).toMatchObject({
        number: item.number,
        revision: 2,
        total: '100.00000000',
        pdfFileId: `generated-${i}`,
        issueDate: '2037-08-03',
        snapshot: { doc: { number: item.number }, revision: 2 },
      });
      const [doc] = await h.db
        .select()
        .from(document)
        .where(eq(document.id, item.signedDocumentId ?? ''));
      expect(doc).toMatchObject({
        number: item.number,
        sourceRevision: 2,
        driveFileId: `signed-${i}`,
      });
      const [previous] = await h.db
        .select()
        .from(invoiceRevision)
        .where(eq(invoiceRevision.invoiceId, item.invoiceId));
      expect(previous).toMatchObject({
        revision: 1,
        reason,
        snapshot: { doc: { number: item.expectedNumber } },
      });
    }
    expect(
      await h.db
        .select()
        .from(invoiceNumberCorrection)
        .where(inArray(invoiceNumberCorrection.invoiceId, ids.invoices)),
    ).toHaveLength(3);
    const [sequence] = await h.db
      .select()
      .from(numberSequence)
      .where(eq(numberSequence.key, prefix));
    expect(sequence?.nextValue).toBe(50);
    const retry = input.map((item) => ({ ...item, expectedNumber: item.number }));
    expect(
      (await reconcileInvoiceNumbers.run(h.ctxFor(owner), { invoices: retry, reason })).isOk(),
    ).toBe(true);
    expect(
      await h.db
        .select()
        .from(invoiceNumberCorrection)
        .where(inArray(invoiceNumberCorrection.invoiceId, ids.invoices)),
    ).toHaveLength(3);
  });
  it('rejects reconciliation once a payment has been allocated', async () => {
    await h.payInvoice(ids.invoices[0] ?? '', '1', '2037-08-03');
    const item = items()[0];
    if (!item) throw new Error('Missing test invoice');
    expect(
      (
        await reconcileInvoiceNumbers.run(h.ctxFor(owner), {
          invoices: [{ ...item, expectedNumber: `${prefix}-1`, number: `${prefix}-paid` }],
          reason,
          dryRun: true,
        })
      ).isErr(),
    ).toBe(true);
  });
});
