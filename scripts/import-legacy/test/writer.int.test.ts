import { createDb } from '@tally/db';
import {
  assignment,
  auditLog,
  billingTerms,
  client,
  company,
  contract,
  document,
  payee,
  payTerms,
  person,
} from '@tally/db/schema';
import { and, eq, gt, inArray, max } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aliasesSchema } from '../src/aliases';
import { buildModel, type Model } from '../src/model';
import { parseCalc } from '../src/sources/calc';
import { parseHeaders } from '../src/sources/headers';
import { writeModel } from '../src/writer';
import { ACT_SHEET, calcBook, calcRow, SOW_SHEET } from './fixtures';

const { db, sql } = createDb(
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  { max: 2 },
);

const book = calcBook(
  {
    July: [
      calcRow({
        employee: 'Int Person',
        partner: 'IntClient',
        role: 'Dev',
        basedOn: 'EXHIBIT A\nSTATEMENT OF WORK #1',
        invoiceType: 'Hours',
        monthPayment: 47,
        payType: 'Fix',
        fixSalary: 3000,
        prepayment: 'Fiat',
      }),
    ],
    Current: [
      calcRow({
        employee: 'Int Person',
        partner: 'IntClient',
        role: 'Dev',
        basedOn: 'EXHIBIT A\nSTATEMENT OF WORK #1',
        invoiceType: 'Hours',
        monthPayment: 50,
        payType: 'Fix',
        fixSalary: 3000,
      }),
    ],
  },
  { 'SOW #1': SOW_SHEET, 'Акт Щурко': ACT_SHEET },
);
const { invoices, acts } = parseHeaders(book);
const aliases = aliasesSchema.parse({
  people: { 'int-person': { fullName: 'Int Person', names: ['Int Person'] } },
  clients: {
    'int-client': {
      legalName: 'Int Client Corp.',
      partnerNames: ['IntClient'],
      invoiceSheets: ['SOW #1'],
    },
  },
  payees: {
    'int-payee': { actSheet: 'Акт Щурко', person: 'int-person', defaultFor: ['int-person'] },
  },
});
const model: Model = buildModel({ bench: [], calc: parseCalc(book).rows, invoices, acts }, aliases);
let hadCompany = false;
let auditStart = 0n;

beforeAll(async () => {
  hadCompany = (await db.select().from(company)).length > 0;
  const [row] = await db.select({ id: max(auditLog.id) }).from(auditLog);
  auditStart = row?.id ?? 0n;
});

afterAll(async () => {
  const refs = (items: { ref: string }[]) => items.map((i) => i.ref);
  await db
    .update(person)
    .set({ defaultPayeeId: null })
    .where(inArray(person.legacyRef, refs(model.persons)));
  await db.delete(billingTerms).where(inArray(billingTerms.legacyRef, refs(model.billing)));
  await db.delete(payTerms).where(inArray(payTerms.legacyRef, refs(model.pay)));
  await db.delete(assignment).where(inArray(assignment.legacyRef, refs(model.assignments)));
  await db.delete(contract).where(inArray(contract.legacyRef, refs(model.contracts)));
  await db.delete(payee).where(inArray(payee.legacyRef, refs(model.payees)));
  await db.delete(client).where(inArray(client.legacyRef, refs(model.clients)));
  await db.delete(person).where(inArray(person.legacyRef, refs(model.persons)));
  await db
    .delete(document)
    .where(
      inArray(document.legacyRef, refs(model.documents.length ? model.documents : [{ ref: '-' }])),
    );
  if (!hadCompany) await db.delete(company);
  await sql.end();
});

describe('writeModel (spec 8, 9.5)', () => {
  it('dry-run validates and writes nothing', async () => {
    const stats = await writeModel(db, model, { dryRun: true });
    expect(stats.assignment).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    expect(
      await db.select().from(person).where(eq(person.legacyRef, 'person:int-person')),
    ).toHaveLength(0);
  });

  it('imports once, then a second run changes nothing', async () => {
    const first = await writeModel(db, model, { dryRun: false });
    expect(first.billing_terms).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
    const second = await writeModel(db, model, { dryRun: false });
    for (const s of Object.values(second)) expect(s.inserted + s.updated).toBe(0);
  });

  it('links the default payee and audits as system:import', async () => {
    const [p] = await db.select().from(person).where(eq(person.legacyRef, 'person:int-person'));
    const [py] = await db.select().from(payee).where(eq(payee.legacyRef, 'payee:int-payee'));
    expect(p?.defaultPayeeId).toBe(py?.id);
    const audited = await db
      .select({ label: auditLog.actorLabel, via: auditLog.via })
      .from(auditLog)
      .where(and(gt(auditLog.id, auditStart), eq(auditLog.tableName, 'assignment')));
    expect(audited).toContainEqual({ label: 'system:import', via: 'import' });
  });

  it('updates a changed value on re-import', async () => {
    const changed: Model = {
      ...model,
      persons: model.persons.map((p) => ({ ...p, position: 'Lead Dev' })),
    };
    const stats = await writeModel(db, changed, { dryRun: false });
    expect(stats.person).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
  });
});
