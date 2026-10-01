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
  job,
  numberSequence,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
  transaction,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { renderActHandler } from '../../jobs/render-act';
import { runNextJob } from '../../jobs/worker';
import { HtmlRenderer } from '../../render/renderers';
import { LocalStorage } from '../../storage/local-storage';
import { payItem } from '../payroll';
import { createAct, issueAct, listActs, saveActDraft, setSignedUrl } from '.';

// August 2045: the 31st is a Thursday, the 26th a Saturday.
const h = intHarness('2045-09-05');
const SEQUENCE = 'test:int-act';
let finance: Awaited<ReturnType<typeof h.user>>;
let root: string;
let storage: LocalStorage;
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  assignment: '',
  period: '',
  item: '',
  account: '',
  transactions: [] as string[],
  acts: [] as string[],
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tally-acts-'));
  storage = new LocalStorage(root);
  finance = await h.user('finance');
  await h.db
    .insert(numberSequence)
    .values({ key: SEQUENCE, template: '9099 - А{seq}', nextValue: 7 });
  const [co] = await h.db.insert(company).values({ nameEn: 'Act', nameUa: 'Акт' }).returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Act Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({
      kind: 'fop',
      legalNameUa: 'ФОП Акт Тест',
      taxId: '1234567890',
      personId: p?.id ?? null,
    })
    .returning();
  await h.db
    .update(person)
    .set({ defaultPayeeId: fop?.id ?? null })
    .where(eq(person.id, p?.id ?? ''));
  const [ct] = await h.db
    .insert(contract)
    .values({
      kind: 'fop',
      number: 'OD-9099',
      companyId: co?.id ?? '',
      payeeId: fop?.id ?? null,
      numberSequenceKey: SEQUENCE,
    })
    .returning();
  const [a] = await h.db
    .insert(assignment)
    .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2045-01-01' })
    .returning();
  const [per] = await h.db
    .insert(period)
    .values({ month: '2045-08-01', workHours: '184' })
    .returning();
  const [item] = await h.db
    .insert(payrollItem)
    .values({
      periodId: per?.id ?? '',
      personId: p?.id ?? '',
      payoutMethod: 'fiat',
      payeeId: fop?.id ?? null,
      totalUsd: '2020',
    })
    .returning();
  await h.db.insert(payrollLine).values({
    payrollItemId: item?.id ?? '',
    assignmentId: a?.id ?? '',
    amountUsd: '2020',
    status: 'payable',
    fundingSource: 'company',
  });
  await h.db.execute(sql`select public.refresh_payroll_item(${item?.id ?? ''})`);
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `Acts UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2045-01-01',
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
    account: acc?.id,
  });
});

afterAll(async () => {
  await h.cleanup(async (db) => {
    await db.delete(transaction).where(inArray(transaction.id, ids.transactions));
    const links = await db
      .select({ id: documentLink.documentId })
      .from(documentLink)
      .where(inArray(documentLink.entityId, ids.acts.length ? ids.acts : [ids.payee]));
    if (links.length) {
      await db.delete(document).where(
        inArray(
          document.id,
          links.map((l) => l.id),
        ),
      );
    }
    await db
      .delete(job)
      .where(inArray(sql`${job.payload} ->> 'actId'`, ids.acts.length ? ids.acts : ['-']));
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(payrollLine).where(eq(payrollLine.payrollItemId, ids.item));
      await tx.delete(payrollItem).where(eq(payrollItem.id, ids.item));
    });
    await db.delete(account).where(eq(account.id, ids.account));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(assignment).where(eq(assignment.id, ids.assignment));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.update(person).set({ defaultPayeeId: null }).where(eq(person.id, ids.person));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(numberSequence).where(eq(numberSequence.key, SEQUENCE));
    await db.delete(company).where(eq(company.id, ids.company));
  });
  await rm(root, { recursive: true, force: true });
});

describe('FOP acts (6.6)', () => {
  it('a fiat FOP payout creates a draft act equal to total_uah to the kopiyka', async () => {
    const paid = await payItem.run(h.ctxFor(finance), {
      itemId: ids.item,
      accountId: ids.account,
      occurredOn: '2045-09-05',
      amount: '89849.60',
      rate: '44.48',
      rateSource: 'manual',
    });
    const value = paid._unsafeUnwrap();
    ids.transactions.push(value.transactionId);
    ids.acts.push(value.actId ?? '');
    const [act] = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.id, value.actId ?? ''));
    expect(act).toMatchObject({
      status: 'draft',
      amountUah: '89849.60',
      actDate: '2045-08-31',
      periodFrom: '2045-08-01',
      periodTo: '2045-08-31',
      type: 'monthly',
    });
  });

  it('a Saturday date is rejected; issue numbers from the contract sequence', async () => {
    const id = ids.acts[0] ?? '';
    await saveActDraft.run(h.ctxFor(finance), { id, actDate: '2045-08-26' });
    const saturday = await issueAct.run(h.ctxFor(finance), { id });
    expect(saturday._unsafeUnwrapErr().message).toMatch(/^db\.nonWorkingDay\|/);
    await saveActDraft.run(h.ctxFor(finance), { id, actDate: '2045-08-31' });
    const issued = await issueAct.run(h.ctxFor(finance), { id });
    expect(issued._unsafeUnwrap().number).toBe('9099 - А7');
    const [act] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, id));
    expect(act?.snapshot).toMatchObject({
      doc: { number: '9099 - А7', date: '31.08.2045' },
      period: { text_ua: 'з 01.08.2045 року по 31.08.2045 року' },
      total: { amount: expect.stringMatching(/^89\s849\.60$/) as string },
    });
  });

  it('renders the act into a document under the payee and stores the Vchasno link', async () => {
    const id = ids.acts[0] ?? '';
    const run = await runNextJob(h.db, {
      render_act: renderActHandler({
        renderer: new HtmlRenderer(),
        storage,
        templateId: undefined,
      }),
    });
    expect(run).toMatchObject({ kind: 'render_act', status: 'done' });
    const [act] = await h.db.select().from(supplierAct).where(eq(supplierAct.id, id));
    expect(act?.pdfFileId).toContain('payees/fop-akt-test/acts/2045/');
    expect(
      (
        await setSignedUrl.run(h.ctxFor(finance), { id, signedUrl: 'https://vchasno.ua/d/1' })
      ).isOk(),
    ).toBe(true);
  });

  it('the registry totals issued acts and flags missing months', async () => {
    const extra = await createAct.run(h.ctxFor(finance), {
      contractId: ids.contract,
      type: 'reimbursement',
      actDate: '2045-09-04',
      amountUah: '1000',
    });
    ids.acts.push(extra._unsafeUnwrap().id);
    await h.db.insert(supplierAct).values({
      contractId: ids.contract,
      payeeId: ids.payee,
      type: 'monthly',
      actDate: '2045-05-31',
      periodFrom: '2045-05-01',
      periodTo: '2045-05-31',
      amountUah: '500',
      isLegacy: true,
      status: 'issued',
      number: '9099 - А5',
    });
    const res = (
      await listActs.run(h.ctxFor(finance), { payeeId: ids.payee, year: 2045 })
    )._unsafeUnwrap();
    expect(res.summary[0]).toMatchObject({ total: '90349.60', missing: ['2045-06', '2045-07'] });
  });
});
