import {
  account,
  assignment,
  company,
  contract,
  contractorInvoice,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { signContractorInvoice } from '../contractor-invoices/sign';
import { payItem } from '.';

const h = intHarness('2046-11-10');
let finance: Awaited<ReturnType<typeof h.user>>;
let owner: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  people: [] as string[],
  payees: [] as string[],
  contracts: [] as string[],
  assignments: [] as string[],
  period: '',
  fopItem: '',
  usdItem: '',
  act: '',
  invoice: '',
  uah: '',
  usd: '',
};

beforeAll(async () => {
  finance = await h.user('finance');
  owner = await h.user('owner');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Signing', nameUa: 'Підпис' })
    .returning();
  ids.company = co?.id ?? '';
  const [per] = await h.db
    .insert(period)
    .values({ month: '2046-10-01', workHours: '184', status: 'closed' })
    .returning();
  ids.period = per?.id ?? '';
  for (const [name, kind, method] of [
    ['Signing FOP', 'fop', 'fiat'],
    ['Signing Abroad', 'other', 'bank_usd'],
  ] as const) {
    const [p] = await h.db.insert(person).values({ fullName: name }).returning();
    const [pe] = await h.db
      .insert(payee)
      .values({ kind, legalNameUa: name, legalNameEn: name, personId: p?.id ?? null })
      .returning();
    const [ct] = await h.db
      .insert(contract)
      .values({
        kind: 'fop',
        number: `SG-${name.length}-${kind}`,
        companyId: ids.company,
        payeeId: pe?.id ?? null,
      })
      .returning();
    const [a] = await h.db
      .insert(assignment)
      .values({ personId: p?.id ?? '', isInternal: true, startsOn: '2046-01-01' })
      .returning();
    const [item] = await h.db
      .insert(payrollItem)
      .values({
        periodId: ids.period,
        personId: p?.id ?? '',
        payoutMethod: method,
        payeeId: pe?.id ?? null,
        totalUsd: '1000',
        ...(method === 'fiat' && {
          payoutFxRate: '40.000000',
          fxSource: 'manual' as const,
          totalUah: '40000.00',
        }),
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
    ids.people.push(p?.id ?? '');
    ids.payees.push(pe?.id ?? '');
    ids.contracts.push(ct?.id ?? '');
    ids.assignments.push(a?.id ?? '');
    if (method === 'fiat') ids.fopItem = item?.id ?? '';
    else ids.usdItem = item?.id ?? '';
  }
  const [act] = await h.db
    .insert(supplierAct)
    .values({
      contractId: ids.contracts[0] ?? '',
      payeeId: ids.payees[0] ?? '',
      payrollItemId: ids.fopItem,
      actDate: '2046-10-31',
      periodFrom: '2046-10-01',
      periodTo: '2046-10-31',
      amountUah: '40000.00',
    })
    .returning();
  ids.act = act?.id ?? '';
  const [inv] = await h.db
    .insert(contractorInvoice)
    .values({
      contractId: ids.contracts[1] ?? '',
      payeeId: ids.payees[1] ?? '',
      payrollItemId: ids.usdItem,
      number: '10112046',
      invoiceDate: '2046-11-10',
      amount: '1000',
      descriptionEn: 'Software Development',
      descriptionUa: 'Розробка програмного забезпечення',
      status: 'issued',
      snapshot: {},
    })
    .returning();
  ids.invoice = inv?.id ?? '';
  for (const currency of ['UAH', 'USD']) {
    const [acc] = await h.db
      .insert(account)
      .values({
        name: `Signing ${currency} ${String(Date.now())}`,
        kind: 'bank',
        currency,
        openingDate: '2046-01-01',
      })
      .returning();
    if (currency === 'UAH') ids.uah = acc?.id ?? '';
    else ids.usd = acc?.id ?? '';
  }
});

afterAll(() =>
  h.cleanup(async (db) => {
    const accounts = [ids.uah, ids.usd];
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(
        sql`delete from public.allocation where payroll_item_id in (${ids.fopItem}, ${ids.usdItem})`,
      );
      // Replica mode skips the FK cascade: postings go first, then their transactions.
      const paid = sql`(select transaction_id from public.posting where account_id in (${ids.uah}, ${ids.usd}))`;
      const txIds = await tx.execute<{ id: string }>(
        sql`select distinct transaction_id as id from public.posting where account_id in (${ids.uah}, ${ids.usd})`,
      );
      await tx.execute(sql`delete from public.posting where transaction_id in ${paid}`);
      for (const { id } of txIds)
        await tx.execute(sql`delete from public.transaction where id = ${id}`);
      await tx.delete(supplierAct).where(inArray(supplierAct.contractId, ids.contracts));
      await tx.delete(contractorInvoice).where(eq(contractorInvoice.id, ids.invoice));
      await tx
        .delete(payrollLine)
        .where(inArray(payrollLine.payrollItemId, [ids.fopItem, ids.usdItem]));
      await tx.delete(payrollItem).where(eq(payrollItem.periodId, ids.period));
    });
    await db.delete(account).where(inArray(account.id, accounts));
    await db.delete(period).where(eq(period.id, ids.period));
    await db.delete(assignment).where(inArray(assignment.id, ids.assignments));
    await db.delete(contract).where(inArray(contract.id, ids.contracts));
    await db.delete(payee).where(inArray(payee.id, ids.payees));
    await db.delete(person).where(inArray(person.id, ids.people));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const payFop = (who: typeof finance, amount: string, extra: Record<string, string> = {}) =>
  payItem.run(h.ctxFor(who), {
    itemId: ids.fopItem,
    accountId: ids.uah,
    occurredOn: '2046-11-10',
    amount,
    ...extra,
  });

describe('document → signature → payment (A-096)', () => {
  it('refuses to pay a FOP payout until its act is issued and signed', async () => {
    expect((await payFop(finance, '40000'))._unsafeUnwrapErr().message).toBe(
      'payroll.actNotSigned',
    );
    const ownerNoReason = (await payFop(owner, '40000'))._unsafeUnwrapErr();
    expect(ownerNoReason.fieldErrors?.documentOverrideReason).toBeDefined();
    expect(
      (await payFop(finance, '40000', { documentOverrideReason: 'Urgent' }))._unsafeUnwrapErr()
        .message,
    ).toBe('payroll.documentOwnerOnly');

    await h.db
      .update(supplierAct)
      .set({ status: 'issued', number: 'SG - А1', snapshot: {} })
      .where(eq(supplierAct.id, ids.act));
    expect((await payFop(finance, '40000'))._unsafeUnwrapErr().message).toBe(
      'payroll.actNotSigned',
    );
  });

  it('pays a signed act in full, but not a part cut off it', async () => {
    await h.db
      .update(supplierAct)
      .set({ signedUrl: 'https://vchasno.ua/doc/1' })
      .where(eq(supplierAct.id, ids.act));
    expect((await payFop(finance, '10000'))._unsafeUnwrapErr().message).toBe('payroll.actFirst');
    expect((await payFop(finance, '40000')).isOk()).toBe(true);
  });

  it('pays a contractor abroad once the contractor invoice is signed', async () => {
    const pay = () =>
      payItem.run(h.ctxFor(finance), {
        itemId: ids.usdItem,
        accountId: ids.usd,
        occurredOn: '2046-11-10',
        amount: '1000',
      });
    expect((await pay())._unsafeUnwrapErr().message).toBe('payroll.invoiceNotSigned');
    expect(
      (await signContractorInvoice.run(h.ctxFor(finance), { id: ids.invoice }))._unsafeUnwrapErr()
        .fieldErrors?.signedUrl,
    ).toBeDefined();
    (
      await signContractorInvoice.run(h.ctxFor(finance), {
        id: ids.invoice,
        signedUrl: 'https://docusign.net/signed/1',
      })
    )._unsafeUnwrap();
    expect((await pay()).isOk()).toBe(true);
  });
});
