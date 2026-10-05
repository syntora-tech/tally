import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  account,
  adjustment,
  company,
  contract,
  document,
  documentLink,
  fxRate,
  payee,
  period,
  person,
  supplierAct,
  transaction,
  trip,
} from '@tally/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { LocalStorage } from '../../storage/local-storage';
import { deleteTripExpense, getTrip, listTrips, saveTrip, tripExpenseServices } from '.';
import { tripBatchServices, upsertTrips } from './batch';
import { createReimbursement, payReimbursement } from './reimbursements';

const h = intHarness('2048-06-01');
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
let root: string;
let services: ReturnType<typeof tripExpenseServices>;
const ids = {
  company: '',
  people: [] as string[],
  payee: '',
  contract: '',
  account: '',
  trips: [] as string[],
  transactions: [] as string[],
  period: '',
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'tally-trips-'));
  services = tripExpenseServices(() => new LocalStorage(root));
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  await h.db.insert(fxRate).values([
    { onDate: '2048-05-10', base: 'EUR', quote: 'UAH', rate: '50', source: 'nbu' },
    { onDate: '2048-05-10', base: 'USD', quote: 'UAH', rate: '40', source: 'nbu' },
  ]);
  const [co] = await h.db.insert(company).values({ nameEn: 'Tr', nameUa: 'Тр' }).returning();
  const people = await h.db
    .insert(person)
    .values([{ fullName: 'Trip Traveller' }, { fullName: 'Trip Second' }])
    .returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Поїздка Інт' })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'TRIP-FOP', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  const [acc] = await h.db
    .insert(account)
    .values({
      name: `Trips UAH ${String(Date.now())}`,
      kind: 'bank',
      currency: 'UAH',
      openingDate: '2048-01-01',
    })
    .returning();
  Object.assign(ids, {
    company: co?.id,
    people: people.map((p) => p.id),
    payee: fop?.id,
    contract: ct?.id,
    account: acc?.id,
  });
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(supplierAct).where(eq(supplierAct.payeeId, ids.payee));
    if (ids.transactions.length) {
      await db.delete(transaction).where(inArray(transaction.id, ids.transactions));
    }
    const links = await db
      .select({ id: documentLink.documentId })
      .from(documentLink)
      .where(and(eq(documentLink.entityType, 'trip'), inArray(documentLink.entityId, ids.trips)));
    await db.delete(trip).where(inArray(trip.id, ids.trips));
    if (ids.period) {
      await db.delete(adjustment).where(eq(adjustment.periodId, ids.period));
      await db.delete(period).where(eq(period.id, ids.period));
    }
    if (links.length) {
      await db.delete(document).where(
        inArray(
          document.id,
          links.map((l) => l.id),
        ),
      );
    }
    await db.delete(account).where(eq(account.id, ids.account));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(inArray(person.id, ids.people));
    await db.delete(company).where(eq(company.id, ids.company));
    await db.delete(fxRate).where(eq(fxRate.onDate, '2048-05-10'));
    await rm(root, { recursive: true, force: true });
  }),
);

const expense = (tripId: string, over: Record<string, unknown> = {}) => ({
  tripId,
  personId: ids.people[0] ?? '',
  spentOn: '2048-05-10',
  description: 'Hotel',
  amount: '100',
  currency: 'EUR',
  reimbursable: 'on',
  ...over,
});

describe('trips (6.8, A-070)', () => {
  it('creates trips with participants; viewers see them', async () => {
    for (const title of ['Int Conf A', 'Int Conf B']) {
      const res = await saveTrip.run(h.ctxFor(finance), {
        title,
        startsOn: '2048-05-10',
        endsOn: '2048-05-12',
        participantIds: ids.people,
      });
      ids.trips.push(res._unsafeUnwrap().id);
    }
    const noPeople = await saveTrip.run(h.ctxFor(finance), {
      title: 'Empty',
      startsOn: '2048-05-10',
      endsOn: '2048-05-12',
    });
    expect(noPeople._unsafeUnwrapErr().fieldErrors?.participantIds).toBeDefined();
    const seen = (await listTrips.run(h.ctxFor(viewer), {}))._unsafeUnwrap();
    expect(seen.find((t) => t.trip.id === ids.trips[0])?.participants).toHaveLength(2);
  });

  it('values an expense at NBU, keeps the receipt and warns about the same receipt elsewhere', async () => {
    const [a = '', b = ''] = ids.trips;
    const file = new File([new Uint8Array([1, 2, 3])], 'hotel.pdf', { type: 'application/pdf' });
    const first = await services.addTripExpense.run(
      h.ctxFor(finance),
      expense(a, { receipt: file }),
    );
    first._unsafeUnwrap();
    const card = (await getTrip.run(h.ctxFor(finance), { id: a }))._unsafeUnwrap();
    expect(card.expenses[0]?.expense).toMatchObject({
      amountUah: '5000.00',
      amountUsd: '125.00000000',
      fxRate: '50.000000',
      fxSource: 'nbu',
    });
    expect(card.expenses[0]?.receiptKey).toContain('trips/2048/int-conf-a/receipts');

    const twice = await services.addTripExpense.run(h.ctxFor(finance), expense(b));
    expect(twice._unsafeUnwrapErr().fieldErrors?.allowDuplicate?.[0]).toMatch(
      /^trips\.duplicateIn\|/,
    );
    const anyway = await services.addTripExpense.run(
      h.ctxFor(finance),
      expense(b, { allowDuplicate: 'on' }),
    );
    expect(
      (await deleteTripExpense.run(h.ctxFor(finance), { id: anyway._unsafeUnwrap().id })).isOk(),
    ).toBe(true);
  });

  it('books a company-paid expense in the Ledger and never reimburses it', async () => {
    const [a = ''] = ids.trips;
    const noLedger = await services.addTripExpense.run(
      h.ctxFor(finance),
      expense(a, { description: 'Ticket', paidBy: 'company' }),
    );
    expect(noLedger._unsafeUnwrapErr().fieldErrors?.accountId).toBeDefined();
    const other = await services.addTripExpense.run(
      h.ctxFor(finance),
      expense(a, { description: 'Ticket', paidBy: 'company', accountId: ids.account }),
    );
    expect(other._unsafeUnwrapErr().fieldErrors?.accountAmount).toBeDefined();
    (
      await services.addTripExpense.run(
        h.ctxFor(finance),
        expense(a, {
          description: 'Ticket',
          paidBy: 'company',
          accountId: ids.account,
          accountAmount: '5000',
        }),
      )
    )._unsafeUnwrap();
    const card = (await getTrip.run(h.ctxFor(finance), { id: a }))._unsafeUnwrap();
    const ticket = card.expenses.find((e) => e.expense.description === 'Ticket')?.expense;
    expect(ticket).toMatchObject({ paidBy: 'company', reimbursable: false });
    ids.transactions.push(ticket?.transactionId ?? '');
    expect(card.summary.find((s) => s.personId === ids.people[0])).toMatchObject({
      spentUah: '10000.00',
      toReimburseUah: '5000.00',
      remainingUah: '5000.00',
    });
    expect(card.status).toBe('awaiting_reimbursement');
  });

  it('reimburses by a direct payment and settles the trip', async () => {
    const [a = ''] = ids.trips;
    const created = (
      await createReimbursement.run(h.ctxFor(finance), {
        tripId: a,
        personId: ids.people[0],
        amount: '5000',
        method: 'direct_payment',
      })
    )._unsafeUnwrap();
    const tooMuch = await payReimbursement.run(h.ctxFor(finance), {
      reimbursementId: created.id,
      amount: '5001',
      accountId: ids.account,
      occurredOn: '2048-05-20',
    });
    expect(tooMuch.isErr()).toBe(true);
    const paid = (
      await payReimbursement.run(h.ctxFor(finance), {
        reimbursementId: created.id,
        amount: '5000',
        accountId: ids.account,
        occurredOn: '2048-05-20',
      })
    )._unsafeUnwrap();
    ids.transactions.push(paid.transactionId);
    const card = (await getTrip.run(h.ctxFor(finance), { id: a }))._unsafeUnwrap();
    expect(card.reimbursements[0]).toMatchObject({ paidUah: '5000.00', paid: true });
    expect(card.status).toBe('settled');
  });

  it('an act reimbursement drafts an extra act for the payee; participants in use stay', async () => {
    const [, b = ''] = ids.trips;
    await services.addTripExpense.run(
      h.ctxFor(finance),
      expense(b, { description: 'Taxi', amount: '10', personId: ids.people[1] }),
    );
    const act = (
      await createReimbursement.run(h.ctxFor(finance), {
        tripId: b,
        personId: ids.people[1],
        amount: '500',
        method: 'act',
        payeeId: ids.payee,
        actDate: '2048-05-29',
      })
    )._unsafeUnwrap();
    const [draft] = await h.db
      .select()
      .from(supplierAct)
      .where(eq(supplierAct.reimbursementId, act.id));
    expect(draft).toMatchObject({
      type: 'reimbursement',
      status: 'draft',
      amountUah: '500.00',
      periodFrom: '2048-05-10',
      periodTo: '2048-05-12',
    });
    const dropped = await saveTrip.run(h.ctxFor(finance), {
      id: b,
      title: 'Int Conf B',
      startsOn: '2048-05-10',
      endsOn: '2048-05-12',
      participantIds: [ids.people[0]],
    });
    expect(dropped._unsafeUnwrapErr().code).toBe('conflict');
  });

  it('a payroll reimbursement becomes an adjustment of the open month', async () => {
    const [, b = ''] = ids.trips;
    const [open] = await h.db
      .insert(period)
      .values({ month: '2048-06-01', workHours: '176' })
      .returning();
    ids.period = open?.id ?? '';
    const noPeriod = await createReimbursement.run(h.ctxFor(finance), {
      tripId: b,
      personId: ids.people[1],
      amount: '200',
      method: 'payroll',
    });
    expect(noPeriod._unsafeUnwrapErr().fieldErrors?.periodId).toBeDefined();
    (
      await createReimbursement.run(h.ctxFor(finance), {
        tripId: b,
        personId: ids.people[1],
        amount: '200',
        method: 'payroll',
        periodId: ids.period,
      })
    )._unsafeUnwrap();
    const [adj] = await h.db.select().from(adjustment).where(eq(adjustment.periodId, ids.period));
    expect(adj).toMatchObject({
      kind: 'trip_reimbursement',
      personId: ids.people[1],
      amount: '200.00000000',
      currency: 'UAH',
      reason: 'Trip reimbursement: Int Conf B',
    });
  });

  it('agents add trips and expenses in batches with dryRun and duplicate checks (13.3)', async () => {
    const preview = (
      await upsertTrips.run(h.ctxFor(finance), {
        trips: [
          {
            title: 'Int Agent Trip',
            startsOn: '2048-05-10',
            endsOn: '2048-05-11',
            participantIds: [ids.people[0]],
          },
        ],
        dryRun: true,
      })
    )._unsafeUnwrap();
    expect(
      await h.db
        .select()
        .from(trip)
        .where(eq(trip.id, preview.results[0]?.id ?? '')),
    ).toHaveLength(0);
    const created = (
      await upsertTrips.run(h.ctxFor(finance), {
        trips: [
          {
            title: 'Int Agent Trip',
            startsOn: '2048-05-10',
            endsOn: '2048-05-11',
            participantIds: [ids.people[0]],
          },
        ],
      })
    )._unsafeUnwrap();
    const tripId = created.results[0]?.id ?? '';
    ids.trips.push(tripId);
    const { addTripExpenses } = tripBatchServices(() => new LocalStorage(root));
    const failed = await addTripExpenses.run(h.ctxFor(finance), {
      tripId,
      expenses: [
        {
          personId: ids.people[0],
          spentOn: '2048-05-10',
          description: 'Hotel',
          amount: '100',
          currency: 'EUR',
        },
        {
          personId: ids.people[0],
          spentOn: '2048-05-10',
          description: 'Ticket',
          amount: '5',
          currency: 'USD',
          paidBy: 'company',
        },
      ],
    });
    expect(Object.keys(failed._unsafeUnwrapErr().fieldErrors ?? {}).sort()).toEqual([
      'expenses.0',
      'expenses.1',
    ]);
    const added = (
      await addTripExpenses.run(h.ctxFor(finance), {
        tripId,
        expenses: [
          {
            personId: ids.people[0],
            spentOn: '2048-05-10',
            description: 'Taxi',
            amount: '20',
            currency: 'EUR',
            receipt: {
              fileName: 'taxi.jpg',
              mimeType: 'image/jpeg',
              contentBase64: Buffer.from('jpeg').toString('base64'),
            },
          },
        ],
      })
    )._unsafeUnwrap();
    expect(added.results).toEqual([expect.objectContaining({ hasReceipt: true })]);
    const card = (await getTrip.run(h.ctxFor(finance), { id: tripId }))._unsafeUnwrap();
    expect(card.expenses[0]?.expense.amountUah).toBe('1000.00');
    const receiptId = card.expenses[0]?.expense.receiptDocumentId ?? '';
    const [receipt] = await h.db.select().from(document).where(eq(document.id, receiptId));
    expect(receipt).toMatchObject({ type: 'receipt', title: 'Taxi', fileName: 'taxi.jpg' });
  });
});
