import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  client,
  company,
  contract,
  document,
  documentLink,
  invoice,
  invoiceLine,
  numberSequence,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { LocalStorage } from '../../storage/local-storage';
import { documentServices } from '../documents';
import {
  getInvoice,
  issueInvoice,
  issuePreview,
  reissueInvoice,
  saveInvoice,
  voidInvoice,
} from '.';

const h = intHarness('2037-08-03');
const SEQUENCE = 'test:int-invoice';
let finance: Awaited<ReturnType<typeof h.user>>;
let root: string;
let services: ReturnType<typeof documentServices>;
const ids = { company: '', client: '', contract: '', invoices: [] as string[] };

const line = (quantity: string, unitPrice: string) => ({
  descriptionEn: 'Development',
  descriptionUa: 'Розробка',
  quantity,
  unitPrice,
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tally-invoices-'));
  services = documentServices(() => new LocalStorage(root));
  finance = await h.user('finance');
  await h.db
    .insert(numberSequence)
    .values({ key: SEQUENCE, template: 'T{seq}/{yy}', yearScoped: true, currentYear: 2037 });
  const [co] = await h.db.insert(company).values({ nameEn: 'I', nameUa: 'І' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Invoice Client' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'client',
      number: 'INV-1',
      companyId: co?.id ?? '',
      clientId: cl?.id ?? '',
      numberSequenceKey: SEQUENCE,
    })
    .returning();
  Object.assign(ids, { company: co?.id, client: cl?.id, contract: ct?.id });
  const [inv] = await h.db
    .insert(invoice)
    .values({
      clientId: ids.client,
      contractId: ids.contract,
      issueDate: '2037-08-03',
      dueDate: '2037-08-20',
      total: '100',
    })
    .returning();
  ids.invoices.push(inv?.id ?? '');
  await h.db.insert(invoiceLine).values({
    invoiceId: inv?.id ?? '',
    position: 1,
    ...line('1', '100'),
    amount: '100',
  });
});

afterAll(async () => {
  await h.cleanup(async (db) => {
    const docs = await db
      .select({ id: documentLink.documentId })
      .from(documentLink)
      .where(inArray(documentLink.entityId, ids.invoices));
    const docIds = docs.map((d) => d.id);
    if (docIds.length) {
      await db.update(document).set({ supersedesId: null }).where(inArray(document.id, docIds));
      await db.delete(document).where(inArray(document.id, docIds));
    }
    // Issued invoices are undeletable by design (I1); only test cleanup bypasses the triggers.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(invoice).where(inArray(invoice.id, ids.invoices));
    });
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(numberSequence).where(eq(numberSequence.key, SEQUENCE));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  });
  await rm(root, { recursive: true, force: true });
});

describe('invoices (spec 6.5, A-044)', () => {
  const id = () => ids.invoices[0] ?? '';

  it('edits a draft and recomputes total and due date', async () => {
    const res = await saveInvoice.run(h.ctxFor(finance), {
      id: id(),
      issueDate: '2037-08-04',
      lines: [line('184', '47'), line('1', '0.5')],
    });
    expect(res.isOk()).toBe(true);
    const card = (await getInvoice.run(h.ctxFor(finance), { id: id() }))._unsafeUnwrap();
    expect(card.invoice.total).toBe('8648.50000000');
    expect(card.invoice.dueDate).toBe('2037-08-20');
    expect(card.lines.map((l) => l.amount)).toEqual(['8648.00000000', '0.50000000']);
  });

  it('previews the issue date and due date', async () => {
    const preview = (
      await issuePreview.run(h.ctxFor(finance), { id: id(), issueDate: '2037-08-08' })
    )._unsafeUnwrap();
    expect(preview).toMatchObject({
      dueDate: '2037-08-20',
      isWorkingDay: false,
      sequenceKey: SEQUENCE,
    });
  });

  it('issues with a number from the contract sequence and a snapshot', async () => {
    const res = await issueInvoice.run(h.ctxFor(finance), { id: id(), issueDate: '2037-08-04' });
    expect(res._unsafeUnwrap().number).toBe('T1/37');
    const card = (await getInvoice.run(h.ctxFor(finance), { id: id() }))._unsafeUnwrap();
    expect(card.invoice.status).toBe('issued');
    expect(card.invoice.snapshot).toMatchObject({ doc: { number: 'T1/37', date: '04.08.2037' } });
  });

  it('revises an unpaid issued invoice keeping its number', async () => {
    const noReason = await saveInvoice.run(h.ctxFor(finance), {
      id: id(),
      issueDate: '2037-08-04',
      lines: [line('180', '47')],
    });
    expect(noReason._unsafeUnwrapErr().code).toBe('validation_error');

    const res = await saveInvoice.run(h.ctxFor(finance), {
      id: id(),
      issueDate: '2037-08-04',
      lines: [line('180', '47')],
      reason: 'Client corrected hours',
    });
    expect(res._unsafeUnwrap().revision).toBe(2);
    const card = (await getInvoice.run(h.ctxFor(finance), { id: id() }))._unsafeUnwrap();
    expect(card.invoice).toMatchObject({ number: 'T1/37', revision: 2, total: '8460.00000000' });
    expect(card.invoice.snapshot).toMatchObject({
      revision: 2,
      total: { words_en: 'Eight thousand four hundred sixty U.S. dollars 00 cents' },
    });
    expect(card.revisions.map((r) => [r.revision, r.reason])).toEqual([
      [1, 'Client corrected hours'],
    ]);
  });

  it('stores a signed copy tied to the signed revision', async () => {
    const res = await services.attachSignedInvoice.run(h.ctxFor(finance), {
      invoiceId: id(),
      file: new File(['%PDF-1.7'], 'signed.pdf', { type: 'application/pdf' }),
    });
    expect(res.isOk()).toBe(true);
    await saveInvoice.run(h.ctxFor(finance), {
      id: id(),
      issueDate: '2037-08-04',
      lines: [line('176', '47')],
      reason: 'One more fix',
    });
    const card = (await getInvoice.run(h.ctxFor(finance), { id: id() }))._unsafeUnwrap();
    expect(card.invoice.revision).toBe(3);
    expect(card.signed.map((s) => s.sourceRevision)).toEqual([2]);
  });

  it('freezes the invoice after any payment', async () => {
    await h.db
      .update(invoice)
      .set({ status: 'partially_paid', paidAmount: '100' })
      .where(eq(invoice.id, id()));
    const res = await saveInvoice.run(h.ctxFor(finance), {
      id: id(),
      issueDate: '2037-08-04',
      lines: [line('1', '1')],
      reason: 'too late',
    });
    expect(res._unsafeUnwrapErr().code).toBe('conflict');
  });

  it('voids and reissues as a new draft with the same lines', async () => {
    expect((await reissueInvoice.run(h.ctxFor(finance), { id: id() })).isErr()).toBe(true);
    const voided = await voidInvoice.run(h.ctxFor(finance), { id: id(), reason: 'Wrong entity' });
    expect(voided.isOk()).toBe(true);
    const copy = (await reissueInvoice.run(h.ctxFor(finance), { id: id() }))._unsafeUnwrap();
    ids.invoices.push(copy.id);
    const card = (await getInvoice.run(h.ctxFor(finance), { id: copy.id }))._unsafeUnwrap();
    expect(card.invoice).toMatchObject({ status: 'draft', number: null, total: '8272.00000000' });
    expect(card.lines).toHaveLength(1);
  });
});
