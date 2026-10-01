import { randomUUID } from 'node:crypto';
import { createDb, type Db } from '@tally/db';
import {
  account,
  allocation,
  appUser,
  category,
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
    ledger.accounts.push(acc?.id ?? '');
    ledger.transactions.push(txId);
    return txId;
  }

  async function cleanup(extra?: (db: Db) => Promise<unknown>) {
    if (ledger.transactions.length) {
      await db.delete(transaction).where(inArray(transaction.id, ledger.transactions));
      await db.delete(account).where(inArray(account.id, ledger.accounts));
    }
    if (extra) await extra(db);
    for (const id of userIds) await db.execute(sql`delete from auth.users where id = ${id}`);
    await client.end();
  }

  return { db, user, ctxFor, systemCtx, cleanup, payInvoice, today: todayDate };
}
