import { randomUUID } from 'node:crypto';
import { createDb, type Db } from '@tally/db';
import {
  account,
  allocation,
  appUser,
  category,
  invoice,
  invoiceLine,
  invoiceRevision,
  payrollItem,
  payrollLine,
  supplierAct,
  posting,
  transaction,
  type AppRole,
} from '@tally/db/schema';
import { parseLocalDate, type LocalDate } from '@tally/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ServiceContext } from '../server/services/context';

/** Integration-test harness: a raw connection plus users with roles and their service contexts. */
export function intHarness(today = '2026-09-29') {
  const { db, sql: client } = createDb(
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    { max: 3 },
  );
  const userIds: string[] = [];
  const todayDate = parseLocalDate(today)._unsafeUnwrap();

  async function user(role: AppRole) {
    const id = randomUUID();
    const email = `${role}-${id}@int.test`;
    await db.execute(sql`insert into auth.users (id, email) values (${id}, ${email})`);
    await db.insert(appUser).values({ id, email, role });
    userIds.push(id);
    return { id, email, role };
  }

  function ctxFor(
    u: { id: string; email: string; role: AppRole },
    on: LocalDate = todayDate,
  ): ServiceContext {
    return {
      actor: {
        kind: 'user',
        userId: u.id,
        email: u.email,
        role: u.role,
        claims: { sub: u.id, role: 'authenticated', email: u.email },
        via: 'ui',
      },
      today: on,
      db,
      config: { allowedEmails: [] },
    };
  }

  function systemCtx(): ServiceContext {
    return {
      actor: { kind: 'system', label: 'system:test' },
      today: todayDate,
      db,
      config: { allowedEmails: [] },
    };
  }

  const ledger = { accounts: [] as string[], transactions: [] as string[] };

  /** A client payment through the Ledger: revenue transaction + allocation (I7). */
  async function payInvoice(invoiceId: string, amount: string, on = today, currency = 'USD') {
    const [acc] = await db
      .insert(account)
      .values({ name: `int ${randomUUID()}`, kind: 'bank', currency, openingDate: on })
      .returning();
    // Registered first, so a payment the DB rejects does not leak its account.
    ledger.accounts.push(acc?.id ?? '');
    const [cat] = await db
      .select()
      .from(category)
      .where(and(eq(category.txType, 'revenue'), eq(category.name, 'Client Revenue')));
    const txId = await db.transaction(async (tx) => {
      const [t] = await tx
        .insert(transaction)
        .values({ occurredOn: on, type: 'revenue', categoryId: cat?.id ?? '' })
        .returning();
      await tx
        .insert(posting)
        .values({ transactionId: t?.id ?? '', accountId: acc?.id ?? '', amount, currency });
      await tx
        .insert(allocation)
        .values({ transactionId: t?.id ?? '', amount, currency, invoiceId });
      return t?.id ?? '';
    });
    ledger.transactions.push(txId);
    return txId;
  }

  async function cleanup(extra?: (db: Db) => Promise<unknown>) {
    if (ledger.transactions.length) {
      await db.delete(transaction).where(inArray(transaction.id, ledger.transactions));
    }
    if (ledger.accounts.length) {
      await db.delete(account).where(inArray(account.id, ledger.accounts));
    }
    if (extra) await extra(db);
    for (const id of userIds) await db.execute(sql`delete from auth.users where id = ${id}`);
    await client.end();
  }

  return { db, user, ctxFor, systemCtx, cleanup, payInvoice, today: todayDate };
}

/**
 * Removes issued invoices (and the payroll of a period) that triggers protect by design (I1, I6).
 * Replica mode also skips FK cascades, so children are deleted explicitly.
 */
export async function purgeProtected(
  db: Db,
  target: { invoiceIds?: readonly string[]; periodId?: string },
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    if (target.periodId) {
      const items = await tx
        .select({ id: payrollItem.id })
        .from(payrollItem)
        .where(eq(payrollItem.periodId, target.periodId));
      if (items.length) {
        const itemIds = items.map((i) => i.id);
        // Closing drafts monthly FOP acts for every fiat payout of the month (A-076).
        await tx.delete(supplierAct).where(inArray(supplierAct.payrollItemId, itemIds));
        await tx.delete(payrollLine).where(inArray(payrollLine.payrollItemId, itemIds));
        await tx.delete(payrollItem).where(inArray(payrollItem.id, itemIds));
      }
    }
    const invoiceIds = [
      ...(target.invoiceIds ?? []),
      ...(target.periodId
        ? (
            await tx
              .select({ id: invoice.id })
              .from(invoice)
              .where(eq(invoice.periodId, target.periodId))
          ).map((i) => i.id)
        : []),
    ];
    if (invoiceIds.length) {
      await tx.delete(invoiceRevision).where(inArray(invoiceRevision.invoiceId, invoiceIds));
      await tx.delete(invoiceLine).where(inArray(invoiceLine.invoiceId, invoiceIds));
      await tx.delete(invoice).where(inArray(invoice.id, invoiceIds));
    }
  });
}
