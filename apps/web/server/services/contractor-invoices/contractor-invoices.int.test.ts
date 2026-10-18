import { randomUUID } from 'node:crypto';
import {
  account,
  allocation,
  category,
  company,
  contract,
  contractorInvoice,
  job,
  payee,
  payrollItem,
  period,
  person,
  posting,
  transaction,
} from '@tally/db/schema';
import type { LocalDate } from '@tally/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { reopenPeriod } from '../periods';
import {
  deleteContractorInvoiceDraft,
  draftContractorInvoice,
  getContractorInvoice,
  issueContractorInvoice,
  rerenderContractorInvoice,
  listContractorInvoices,
  saveContractorInvoiceDraft,
  voidContractorInvoice,
} from '.';

const h = intHarness();
let finance: Awaited<ReturnType<typeof h.user>>;
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  payee: '',
  fopPayee: '',
  contract: '',
  person: '',
  period: '',
  items: [] as string[],
  fopItem: '',
  account: '',
  tx: '',
};

beforeAll(async () => {
  finance = await h.user('finance');
  owner = await h.user('owner');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Contractor invoice test', nameUa: 'Тест' })
    .returning();
  ids.company = co?.id ?? '';
  const [p] = await h.db
    .insert(payee)
    .values({
      kind: 'other',
      legalNameEn: 'Contractor Abroad',
      taxId: '(Canada) 961-358-652',
      addressEn: 'London, ON',
      bankDetailsEn: 'SWIFT: CIBCCATT',
    })
    .returning();
  ids.payee = p?.id ?? '';
  const [fp] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Тест інвойсу' })
    .returning();
  ids.fopPayee = fp?.id ?? '';
  const [c] = await h.db
    .insert(contract)
    .values({
      kind: 'fop',
      number: `CI-${randomUUID().slice(0, 8)}`,
      signedOn: '2025-10-28',
      companyId: ids.company,
      payeeId: ids.payee,
    })
    .returning();
  ids.contract = c?.id ?? '';
  const [who] = await h.db.insert(person).values({ fullName: 'Contractor test' }).returning();
  ids.person = who?.id ?? '';
  const [month] = await h.db
    .insert(period)
    .values({ month: '2088-09-01', workHours: '176', status: 'closed' })
    .returning();
  ids.period = month?.id ?? '';
  for (const totalUsd of ['3000', '120.5']) {
    const [item] = await h.db
      .insert(payrollItem)
      .values({
        periodId: ids.period,
        personId: ids.person,
        payoutMethod: totalUsd === '3000' ? 'bank_usd' : 'crypto',
        payeeId: ids.payee,
        totalUsd,
      })
      .returning();
    ids.items.push(item?.id ?? '');
  }
  const [fopItem] = await h.db
    .insert(payrollItem)
    .values({
      periodId: ids.period,
      personId: ids.person,
      payoutMethod: 'fiat',
      payeeId: ids.fopPayee,
      totalUsd: '1000',
    })
    .returning();
  ids.fopItem = fopItem?.id ?? '';
});

afterAll(async () =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(contractorInvoice).where(eq(contractorInvoice.payeeId, ids.payee));
    });
    if (ids.tx) await db.delete(transaction).where(eq(transaction.id, ids.tx));
    if (ids.account) await db.delete(account).where(eq(account.id, ids.account));
    await db.delete(job).where(sql`${job.kind} = 'render_contractor_invoice'`);
    await db.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(inArray(payee.id, [ids.payee, ids.fopPayee]));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('contractor invoices (A-090)', () => {
  it('drafts from a USD payout to a non-FOP payee and follows the payout until issued', async () => {
    const ctx = h.ctxFor(finance);
    const draft = (
      await draftContractorInvoice.run(ctx, { payrollItemId: ids.items[0] ?? '' })
    )._unsafeUnwrap();
    const [row] = await h.db
      .select()
      .from(contractorInvoice)
      .where(eq(contractorInvoice.id, draft.id));
    expect(row).toMatchObject({
      status: 'draft',
      number: null,
      amount: '3000.00',
      currency: 'USD',
      invoiceDate: '2026-09-29',
      periodFrom: '2088-09-01',
      periodTo: '2088-09-30',
      contractId: ids.contract,
      descriptionEn: 'Software Development',
    });
    await h.db
      .update(payrollItem)
      .set({ totalUsd: '2863.636364' })
      .where(eq(payrollItem.id, ids.items[0] ?? ''));
    const again = (
      await draftContractorInvoice.run(ctx, { payrollItemId: ids.items[0] ?? '' })
    )._unsafeUnwrap();
    expect(again.id).toBe(draft.id);
    const [refreshed] = await h.db
      .select({ amount: contractorInvoice.amount })
      .from(contractorInvoice)
      .where(eq(contractorInvoice.id, draft.id));
    expect(refreshed?.amount).toBe('2863.64');
  });

  it('refuses a FOP payout', async () => {
    const result = await draftContractorInvoice.run(h.ctxFor(finance), {
      payrollItemId: ids.fopItem,
    });
    expect(result._unsafeUnwrapErr().message).toBe('contractorInvoices.notForPayout');
  });

  it('issues with the date as the number, a snapshot and a render job; then it is frozen', async () => {
    const ctx = h.ctxFor(finance);
    const [draft] = (await listContractorInvoices.run(ctx, { payeeId: ids.payee }))._unsafeUnwrap()
      .items;
    const id = draft?.id ?? '';
    expect(
      (
        await saveContractorInvoiceDraft.run(ctx, {
          id,
          invoiceDate: '2026-10-13',
          descriptionEn: 'Software Development',
          descriptionUa: 'Розробка програмного забезпечення',
        })
      ).isOk(),
    ).toBe(true);
    const issued = (await issueContractorInvoice.run(ctx, { id }))._unsafeUnwrap();
    expect(issued.number).toBe('13102026');
    const [row] = await h.db.select().from(contractorInvoice).where(eq(contractorInvoice.id, id));
    expect(row?.snapshot).toMatchObject({
      doc: { number: '13102026', date: '13.10.2026' },
      payee: { name_en: 'Contractor Abroad', bank_en: 'SWIFT: CIBCCATT' },
      total: { currency: 'USD' },
    });
    const jobs = await h.db
      .select()
      .from(job)
      .where(eq(job.dedupeKey, `render_contractor_invoice:${id}`));
    expect(jobs).toHaveLength(1);

    await expect(
      h.db.update(contractorInvoice).set({ amount: '1.00' }).where(eq(contractorInvoice.id, id)),
    ).rejects.toThrow();
    await expect(
      h.db.delete(contractorInvoice).where(eq(contractorInvoice.id, id)),
    ).rejects.toThrow();
    expect((await deleteContractorInvoiceDraft.run(ctx, { id }))._unsafeUnwrapErr().message).toBe(
      'contractorInvoices.draftOnly',
    );
  });

  it('shows the payout of the invoice and the payments that paid it (A-116)', async () => {
    const ctx = h.ctxFor(finance);
    const [issued] = (
      await listContractorInvoices.run(ctx, { payeeId: ids.payee, status: 'issued' })
    )._unsafeUnwrap().items;
    const before = (await getContractorInvoice.run(ctx, { id: issued?.id ?? '' }))._unsafeUnwrap();
    expect(before.payout).toMatchObject({
      itemId: ids.items[0],
      periodId: ids.period,
      payments: [],
    });
    expect(before.payout?.status).not.toBe('paid');

    const [acc] = await h.db
      .insert(account)
      .values({
        name: `ci ${randomUUID()}`,
        kind: 'bank',
        currency: 'USD',
        openingDate: '2026-10-01',
      })
      .returning();
    ids.account = acc?.id ?? '';
    const [cat] = await h.db.select().from(category).where(eq(category.txType, 'expense')).limit(1);
    const [item] = await h.db
      .select()
      .from(payrollItem)
      .where(eq(payrollItem.id, ids.items[0] ?? ''));
    const total = item?.totalUsd ?? '0';
    ids.tx = await h.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(transaction)
        .values({ occurredOn: '2026-10-18', type: 'expense', categoryId: cat?.id ?? '' })
        .returning();
      await tx.insert(posting).values({
        transactionId: t?.id ?? '',
        accountId: ids.account,
        amount: '-3000',
        currency: 'USD',
      });
      await tx.insert(allocation).values({
        transactionId: t?.id ?? '',
        amount: total,
        currency: 'USD',
        payrollItemId: ids.items[0] ?? '',
      });
      return t?.id ?? '';
    });
    const after = (await getContractorInvoice.run(ctx, { id: issued?.id ?? '' }))._unsafeUnwrap();
    expect(after.payout).toMatchObject({
      status: 'paid',
      payments: [{ transactionId: ids.tx, occurredOn: '2026-10-18', amount: total }],
    });
  });

  it('numbers a second invoice of the same day with /1 and refuses a taken number', async () => {
    const ctx = h.ctxFor(finance);
    const { id } = (
      await draftContractorInvoice.run(h.ctxFor(finance, '2026-10-13' as LocalDate), {
        payrollItemId: ids.items[1] ?? '',
      })
    )._unsafeUnwrap();
    expect(
      (await issueContractorInvoice.run(ctx, { id, number: '13102026' }))._unsafeUnwrapErr()
        .message,
    ).toContain('contractorInvoices.numberTaken');
    expect((await issueContractorInvoice.run(ctx, { id }))._unsafeUnwrap().number).toBe(
      '13102026/1',
    );
  });

  it('re-renders with the payee requisites of the card paid or not (A-094)', async () => {
    const ctx = h.ctxFor(finance);
    const [inv] = (
      await listContractorInvoices.run(ctx, { payrollItemIds: [ids.items[0] ?? ''] })
    )._unsafeUnwrap().items;
    const id = inv?.id ?? '';
    await h.db
      .update(contractorInvoice)
      .set({ pdfFileId: 'pdf-1' })
      .where(eq(contractorInvoice.id, id));
    await h.db
      .update(payee)
      .set({ legalNameEn: 'Contractor Renamed' })
      .where(eq(payee.id, ids.payee));
    (await rerenderContractorInvoice.run(ctx, { id, reason: 'Name fixed' }))._unsafeUnwrap();
    const [row] = await h.db.select().from(contractorInvoice).where(eq(contractorInvoice.id, id));
    const snapshot = row?.snapshot as { payee: { name_en: string }; doc: { number: string } };
    expect(snapshot.payee.name_en).toBe('Contractor Renamed');
    expect(snapshot.doc.number).toBe(row?.number);
    expect(row).toMatchObject({ pdfFileId: null, amount: inv?.amount });

    await h.db
      .update(payrollItem)
      .set({ paidAmount: '1' })
      .where(eq(payrollItem.id, ids.items[0] ?? ''));
    await h.db
      .update(payee)
      .set({ legalNameEn: 'Contractor Later' })
      .where(eq(payee.id, ids.payee));
    (await rerenderContractorInvoice.run(ctx, { id, reason: 'Again' }))._unsafeUnwrap();
    const [paid] = await h.db.select().from(contractorInvoice).where(eq(contractorInvoice.id, id));
    // A paid payout does not freeze the requisites: they are not figures.
    expect((paid?.snapshot as { payee: { name_en: string } }).payee.name_en).toBe(
      'Contractor Later',
    );
    await h.db
      .update(payrollItem)
      .set({ paidAmount: '0' })
      .where(eq(payrollItem.id, ids.items[0] ?? ''));
  });

  it('blocks reopening the period, voids with a reason and deletes only drafts', async () => {
    const reopened = await reopenPeriod.run(h.ctxFor(owner), {
      periodId: ids.period,
      reason: 'test',
    });
    expect(reopened._unsafeUnwrapErr().message).toContain('periods.contractorInvoiceIssued');
    const ctx = h.ctxFor(finance);
    const [first] = (
      await listContractorInvoices.run(ctx, { payrollItemIds: [ids.items[0] ?? ''] })
    )._unsafeUnwrap().items;
    expect(
      (await voidContractorInvoice.run(ctx, { id: first?.id ?? '', reason: 'Wrong month' })).isOk(),
    ).toBe(true);
    const redraft = (
      await draftContractorInvoice.run(ctx, { payrollItemId: ids.items[0] ?? '' })
    )._unsafeUnwrap();
    expect(redraft.id).not.toBe(first?.id);
    expect((await deleteContractorInvoiceDraft.run(ctx, { id: redraft.id })).isOk()).toBe(true);
  });
});
