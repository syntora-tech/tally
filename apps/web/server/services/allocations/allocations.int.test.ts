import {
  account,
  category,
  client,
  company,
  contract,
  invoice,
  invoiceLine,
  transaction,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { createTransaction } from '../ledger';
import { allocateToInvoice, invoiceAllocations, paymentCandidates, removeAllocation } from '.';

const h = intHarness('2035-05-01');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = { company: '', client: '', contract: '', invoice: '', usd: '', uah: '' };
const txIds: string[] = [];

async function revenue(accountId: string, amount: string) {
  const [cat] = await h.db
    .select()
    .from(category)
    .where(and(eq(category.txType, 'revenue'), eq(category.name, 'Client Revenue')));
  const res = await createTransaction.run(h.ctxFor(finance), {
    type: 'revenue',
    occurredOn: '2035-05-10',
    categoryId: cat?.id,
    counterparty: 'Alloc client',
    to: { accountId, amount },
  });
  const id = res._unsafeUnwrap().id;
  txIds.push(id);
  return id;
}

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'A', nameUa: 'А' }).returning();
  const [cl] = await h.db.insert(client).values({ legalName: 'Alloc client' }).returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'client', number: 'AL-1', companyId: co?.id ?? '', clientId: cl?.id ?? '' })
    .returning();
  const [inv] = await h.db
    .insert(invoice)
    .values({
      clientId: cl?.id ?? '',
      contractId: ct?.id ?? '',
      issueDate: '2035-05-01',
      dueDate: '2035-05-20',
      total: '1000',
      isLegacy: true,
    })
    .returning();
  await h.db.insert(invoiceLine).values({
    invoiceId: inv?.id ?? '',
    position: 1,
    descriptionEn: 'Dev',
    descriptionUa: 'Розробка',
    quantity: '1',
    unitPrice: '1000',
    amount: '1000',
  });
  await h.db
    .update(invoice)
    .set({ status: 'issued', number: `AL-${String(Date.now())}` })
    .where(eq(invoice.id, inv?.id ?? ''));
  const accs = await h.db
    .insert(account)
    .values([
      {
        name: `Alloc USD ${String(Date.now())}`,
        kind: 'bank',
        currency: 'USD',
        openingDate: '2035-01-01',
      },
      {
        name: `Alloc UAH ${String(Date.now())}`,
        kind: 'bank',
        currency: 'UAH',
        openingDate: '2035-01-01',
      },
    ])
    .returning();
  Object.assign(ids, {
    company: co?.id,
    client: cl?.id,
    contract: ct?.id,
    invoice: inv?.id,
    usd: accs[0]?.id,
    uah: accs[1]?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(transaction).where(inArray(transaction.id, txIds));
    await db.delete(account).where(inArray(account.id, [ids.usd, ids.uah]));
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(invoice).where(eq(invoice.id, ids.invoice));
    });
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('invoice payments (6.5, I7)', () => {
  it('offers revenue with free money and allocates part of it', async () => {
    const usdTx = await revenue(ids.usd, '600');
    const candidates = (
      await paymentCandidates.run(h.ctxFor(finance), { invoiceId: ids.invoice })
    )._unsafeUnwrap();
    expect(candidates.find((c) => c.id === usdTx)).toMatchObject({
      remaining: '600.00',
      needsRate: false,
    });
    const res = await allocateToInvoice.run(h.ctxFor(finance), {
      invoiceId: ids.invoice,
      transactionId: usdTx,
      amount: '600',
    });
    expect(res.isOk()).toBe(true);
    const [inv] = await h.db.select().from(invoice).where(eq(invoice.id, ids.invoice));
    expect(inv?.status).toBe('partially_paid');
    const after = (
      await paymentCandidates.run(h.ctxFor(finance), { invoiceId: ids.invoice })
    )._unsafeUnwrap();
    expect(after.find((c) => c.id === usdTx)).toBeUndefined();
  });

  it('needs a rate for a UAH payment and rejects overpayment', async () => {
    const uahTx = await revenue(ids.uah, '20000');
    const noRate = await allocateToInvoice.run(h.ctxFor(finance), {
      invoiceId: ids.invoice,
      transactionId: uahTx,
      amount: '400',
    });
    expect(noRate._unsafeUnwrapErr().message).toContain('вкажіть курс');
    const over = await allocateToInvoice.run(h.ctxFor(finance), {
      invoiceId: ids.invoice,
      transactionId: uahTx,
      amount: '450',
      fxRate: '44',
    });
    expect(over._unsafeUnwrapErr().message).toContain('залишок інвойсу');
    const paid = await allocateToInvoice.run(h.ctxFor(finance), {
      invoiceId: ids.invoice,
      transactionId: uahTx,
      amount: '400',
      fxRate: '44',
    });
    expect(paid.isOk()).toBe(true);
    const [inv] = await h.db.select().from(invoice).where(eq(invoice.id, ids.invoice));
    expect(inv?.status).toBe('paid');
  });

  it('removing an allocation reopens the debt', async () => {
    const list = (
      await invoiceAllocations.run(h.ctxFor(finance), { invoiceId: ids.invoice })
    )._unsafeUnwrap();
    expect(list).toHaveLength(2);
    await removeAllocation.run(h.ctxFor(finance), { id: list[1]?.id ?? '' });
    const [inv] = await h.db.select().from(invoice).where(eq(invoice.id, ids.invoice));
    expect(inv?.status).toBe('partially_paid');
  });
});
