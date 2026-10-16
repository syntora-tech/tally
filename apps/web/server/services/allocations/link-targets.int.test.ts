import {
  account,
  allocation,
  category,
  client,
  company,
  contract,
  invoice,
  invoiceLine,
  plannedExpense,
  plannedPayment,
  transaction,
} from '@tally/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness, purgeProtected } from '../../../test/int-helpers';
import { createTransaction } from '../ledger';
import { savePlannedExpense } from '../planned';
import { markPlannedPaid } from '../planned/payments';
import { allocateToInvoice, allocateToInvoices } from '.';
import { linkTargets } from './link-targets';

const h = intHarness('2036-04-10');
let finance: Awaited<ReturnType<typeof h.user>>;
const tag = `LT ${String(Date.now())}`;
const ids = { company: '', client: '', contract: '', invoice: '', usd: '', uah: '', rule: '' };
const txIds: string[] = [];
const extraInvoices: string[] = [];

async function issuedInvoice(total: string, number: string) {
  const [inv] = await h.db
    .insert(invoice)
    .values({
      clientId: ids.client,
      contractId: ids.contract,
      issueDate: '2036-04-02',
      dueDate: '2036-04-25',
      total,
      isLegacy: true,
    })
    .returning();
  const id = inv?.id ?? '';
  await h.db.insert(invoiceLine).values({
    invoiceId: id,
    position: 1,
    descriptionEn: 'Dev',
    descriptionUa: 'Розробка',
    quantity: '1',
    unitPrice: total,
    amount: total,
  });
  await h.db.update(invoice).set({ status: 'issued', number }).where(eq(invoice.id, id));
  extraInvoices.push(id);
  return id;
}

async function book(type: 'revenue' | 'expense', accountId: string, amount: string, name: string) {
  const [cat] = await h.db
    .select()
    .from(category)
    .where(and(eq(category.txType, type), eq(category.name, name)));
  const res = await createTransaction.run(h.ctxFor(finance), {
    type,
    occurredOn: '2036-04-10',
    categoryId: cat?.id,
    clientId: type === 'revenue' ? ids.client : undefined,
    ...(type === 'revenue' ? { to: { accountId, amount } } : { from: { accountId, amount } }),
  });
  const id = res._unsafeUnwrap().id;
  txIds.push(id);
  return id;
}

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db.insert(company).values({ nameEn: 'L', nameUa: 'Л' }).returning();
  const [cl] = await h.db
    .insert(client)
    .values({ legalName: `${tag} client` })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'client', number: tag, companyId: co?.id ?? '', clientId: cl?.id ?? '' })
    .returning();
  const [inv] = await h.db
    .insert(invoice)
    .values({
      clientId: cl?.id ?? '',
      contractId: ct?.id ?? '',
      issueDate: '2036-04-01',
      dueDate: '2036-04-20',
      total: '500',
      isLegacy: true,
    })
    .returning();
  await h.db.insert(invoiceLine).values({
    invoiceId: inv?.id ?? '',
    position: 1,
    descriptionEn: 'Dev',
    descriptionUa: 'Розробка',
    quantity: '1',
    unitPrice: '500',
    amount: '500',
  });
  await h.db
    .update(invoice)
    .set({ status: 'issued', number: tag })
    .where(eq(invoice.id, inv?.id ?? ''));
  const accs = await h.db
    .insert(account)
    .values([
      { name: `${tag} USD`, kind: 'bank', currency: 'USD', openingDate: '2036-01-01' },
      { name: `${tag} UAH`, kind: 'bank', currency: 'UAH', openingDate: '2036-01-01' },
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
  const [tools] = await h.db
    .select()
    .from(category)
    .where(and(eq(category.txType, 'expense'), eq(category.name, 'Software / Tools')));
  const rule = await savePlannedExpense.run(h.ctxFor(finance), {
    name: `${tag} plan`,
    categoryId: tools?.id,
    amount: '1200',
    currency: 'UAH',
    dueDay: '12',
    startsOn: '2036-04',
  });
  ids.rule = rule._unsafeUnwrap().id;
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(allocation).where(inArray(allocation.transactionId, txIds));
      await tx.delete(plannedPayment).where(eq(plannedPayment.plannedExpenseId, ids.rule));
    });
    await db.delete(transaction).where(inArray(transaction.id, txIds));
    await db.delete(plannedExpense).where(eq(plannedExpense.id, ids.rule));
    await db.delete(account).where(inArray(account.id, [ids.usd, ids.uah]));
    await purgeProtected(db, { invoiceIds: [ids.invoice, ...extraInvoices] });
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(client).where(eq(client.id, ids.client));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

describe('linkTargets (A-106)', () => {
  it('offers a revenue the open invoices, its client first, until it is fully linked', async () => {
    const txId = await book('revenue', ids.usd, '500', 'Client Revenue');
    const ctx = h.ctxFor(finance);
    const before = (await linkTargets.run(ctx, { transactionId: txId }))._unsafeUnwrap();
    expect(before).toMatchObject({ type: 'revenue', free: '500.00', planned: [], payouts: [] });
    expect(before.invoices[0]).toMatchObject({
      id: ids.invoice,
      match: true,
      remaining: '500.00',
      needsRate: false,
    });

    await allocateToInvoice.run(ctx, {
      invoiceId: ids.invoice,
      transactionId: txId,
      amount: '500',
    });
    const after = (await linkTargets.run(ctx, { transactionId: txId }))._unsafeUnwrap();
    expect(after).toMatchObject({ free: '0.00', invoices: [] });
  });

  it('offers an expense the due planned payments in its currency only', async () => {
    const ctx = h.ctxFor(finance);
    const uahTx = await book('expense', ids.uah, '1200', 'Software / Tools');
    const usdTx = await book('expense', ids.usd, '30', 'Software / Tools');
    const uah = (await linkTargets.run(ctx, { transactionId: uahTx }))._unsafeUnwrap();
    const plan = uah.planned.find((p) => p.label === `${tag} plan`);
    expect(plan).toMatchObject({ dueOn: '2036-04-12', amount: '1200.00' });
    expect(uah.invoices).toEqual([]);
    const usd = (await linkTargets.run(ctx, { transactionId: usdTx }))._unsafeUnwrap();
    expect(usd.planned.find((p) => p.label === `${tag} plan`)).toBeUndefined();
    expect(usd.reimbursements).toEqual([]);

    await markPlannedPaid.run(ctx, { id: plan?.id ?? '', transactionIds: [uahTx] });
    const paid = (await linkTargets.run(ctx, { transactionId: uahTx }))._unsafeUnwrap();
    expect(paid.free).toBe('0.00');
    expect(paid.planned).toEqual([]);
  });

  it('offers payouts only to payroll and contractor expenses', async () => {
    const ctx = h.ctxFor(finance);
    const tools = await book('expense', ids.uah, '10', 'Software / Tools');
    expect((await linkTargets.run(ctx, { transactionId: tools }))._unsafeUnwrap().payouts).toEqual(
      [],
    );
  });

  it('pays several invoices from one receipt, all of them or none', async () => {
    const ctx = h.ctxFor(finance);
    const a = await issuedInvoice('400', `${tag}-A`);
    const b = await issuedInvoice('200', `${tag}-B`);
    const txId = await book('revenue', ids.usd, '600', 'Client Revenue');
    const linked = async () =>
      (await h.db.select().from(allocation).where(eq(allocation.transactionId, txId))).length;

    // B is only 200: the whole batch is refused, A is not left half-done.
    const over = await allocateToInvoices.run(ctx, {
      transactionId: txId,
      items: [
        { invoiceId: a, amount: '400' },
        { invoiceId: b, amount: '250' },
      ],
    });
    expect(over.isErr()).toBe(true);
    expect(await linked()).toBe(0);

    const res = await allocateToInvoices.run(ctx, {
      transactionId: txId,
      items: [
        { invoiceId: a, amount: '400' },
        { invoiceId: b, amount: '200' },
      ],
    });
    expect(res.isOk()).toBe(true);
    expect(await linked()).toBe(2);
    const statuses = await h.db
      .select({ status: invoice.status })
      .from(invoice)
      .where(inArray(invoice.id, [a, b]));
    expect(statuses.map((r) => r.status)).toEqual(['paid', 'paid']);
    expect((await linkTargets.run(ctx, { transactionId: txId }))._unsafeUnwrap().free).toBe('0.00');

    const none = await allocateToInvoices.run(ctx, { transactionId: txId, items: [] });
    expect(none.isErr()).toBe(true);
  });

  it('reports an unknown transaction', async () => {
    const res = await linkTargets.run(h.ctxFor(finance), {
      transactionId: '00000000-0000-4000-8000-000000000000',
    });
    expect(res.isErr()).toBe(true);
  });
});
