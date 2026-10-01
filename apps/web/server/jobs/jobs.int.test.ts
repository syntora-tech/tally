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
  job,
  numberSequence,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness, purgeProtected } from '../../test/int-helpers';
import { HtmlRenderer, type DocumentRenderer } from '../render/renderers';
import { getInvoice, issueInvoice, saveInvoice } from '../services/invoices';
import { LocalStorage } from '../storage/local-storage';
import { renderInvoiceHandler } from './render-invoice';
import { runNextJob } from './worker';

const h = intHarness('2039-02-01');
const SEQUENCE = 'test:int-jobs';
let finance: Awaited<ReturnType<typeof h.user>>;
let root: string;
let storage: LocalStorage;
const ids = { company: '', client: '', contract: '', invoice: '' };

const handlers = (renderer: DocumentRenderer) => ({
  render_invoice: renderInvoiceHandler({ renderer, storage, templates: {} }),
});

const jobsOfInvoice = () =>
  h.db
    .select()
    .from(job)
    .where(sql`${job.payload} ->> 'invoiceId' = ${ids.invoice}`)
    .orderBy(job.createdAt);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tally-jobs-'));
  storage = new LocalStorage(root);
  finance = await h.user('finance');
  await h.db.insert(numberSequence).values({ key: SEQUENCE, template: 'J{seq}/{yy}' });
  const [co] = await h.db.insert(company).values({ nameEn: 'J', nameUa: 'Й' }).returning();
  const [cl] = await h.db
    .insert(client)
    .values({ legalName: 'Jobs Client LLC', shortName: 'JobsCo' })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'client',
      number: 'JOB-1',
      companyId: co?.id ?? '',
      clientId: cl?.id ?? '',
      numberSequenceKey: SEQUENCE,
    })
    .returning();
  const [inv] = await h.db
    .insert(invoice)
    .values({
      clientId: cl?.id ?? '',
      contractId: ct?.id ?? '',
      issueDate: '2039-02-01',
      dueDate: '2039-02-20',
      total: '4700',
    })
    .returning();
  Object.assign(ids, { company: co?.id, client: cl?.id, contract: ct?.id, invoice: inv?.id });
  await h.db.insert(invoiceLine).values({
    invoiceId: ids.invoice,
    position: 1,
    descriptionEn: 'Development <b>',
    descriptionUa: 'Розробка',
    quantity: '100',
    unitPrice: '47',
    amount: '4700',
  });
});

afterAll(async () => {
  await h.cleanup(async (db) => {
    await db.delete(job).where(sql`${job.payload} ->> 'invoiceId' = ${ids.invoice}`);
    const docs = await db
      .select({ id: documentLink.documentId })
      .from(documentLink)
      .where(eq(documentLink.entityId, ids.invoice));
    const docIds = docs.map((d) => d.id);
    if (docIds.length) {
      await db.update(document).set({ supersedesId: null }).where(inArray(document.id, docIds));
      await db.delete(document).where(inArray(document.id, docIds));
    }
    await purgeProtected(db, { invoiceIds: [ids.invoice] });
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(numberSequence).where(eq(numberSequence.key, SEQUENCE));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  });
  await rm(root, { recursive: true, force: true });
});

describe('render queue (7.1, 10.4)', () => {
  it('issuing queues a render job that files the document', async () => {
    await issueInvoice.run(h.ctxFor(finance), { id: ids.invoice, issueDate: '2039-02-01' });
    expect((await jobsOfInvoice()).map((j) => j.status)).toEqual(['queued']);

    const run = await runNextJob(h.db, handlers(new HtmlRenderer()));
    expect(run).toMatchObject({ kind: 'render_invoice', status: 'done' });

    const card = (await getInvoice.run(h.ctxFor(finance), { id: ids.invoice }))._unsafeUnwrap();
    expect(card.invoice.pdfFileId).toContain('clients/jobsco/invoices/2039/');
    const [doc] = await h.db
      .select()
      .from(document)
      .innerJoin(documentLink, eq(documentLink.documentId, document.id))
      .where(eq(documentLink.entityId, ids.invoice));
    expect(doc?.document).toMatchObject({
      type: 'invoice',
      number: 'J1/39',
      title: 'Invoice J1-39 JobsCo 2039-02-01',
      sourceRevision: 1,
      mimeType: 'text/html',
    });
    const html = new TextDecoder().decode(
      (await storage.download(doc?.document.driveFileId ?? ''))?.data,
    );
    expect(html).toContain('Development &lt;b&gt;');
    expect(html).toContain('Four thousand seven hundred U.S. dollars 00 cents');
  });

  it('a revision queues a new render that supersedes the old file', async () => {
    await saveInvoice.run(h.ctxFor(finance), {
      id: ids.invoice,
      issueDate: '2039-02-01',
      lines: [
        { descriptionEn: 'Dev', descriptionUa: 'Розробка', quantity: '1', unitPrice: '5000' },
      ],
      reason: 'Fixed fee agreed',
    });
    await runNextJob(h.db, handlers(new HtmlRenderer()));
    const docs = await h.db
      .select({ version: document.version, sourceRevision: document.sourceRevision })
      .from(document)
      .innerJoin(documentLink, eq(documentLink.documentId, document.id))
      .where(eq(documentLink.entityId, ids.invoice))
      .orderBy(document.version);
    expect(docs).toEqual([
      { version: 1, sourceRevision: 1 },
      { version: 2, sourceRevision: 2 },
    ]);
  });

  it('retries a failing job with backoff, then marks it failed', async () => {
    const failing = { render_invoice: () => Promise.reject(new Error('Docs API down')) };
    await h.db.insert(job).values({
      kind: 'render_invoice',
      payload: { invoiceId: ids.invoice, revision: 2 },
      maxAttempts: 2,
    });

    const first = await runNextJob(h.db, failing);
    expect(first).toMatchObject({ status: 'queued', error: 'Docs API down' });
    const [queued] = (await jobsOfInvoice()).filter((j) => j.maxAttempts === 2);
    expect(queued?.attempts).toBe(1);
    expect(queued?.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(await runNextJob(h.db, failing)).toBeNull();

    await h.db
      .update(job)
      .set({ runAfter: new Date(0) })
      .where(eq(job.id, queued?.id ?? ''));
    expect(await runNextJob(h.db, failing)).toMatchObject({ status: 'failed' });
  });
});
