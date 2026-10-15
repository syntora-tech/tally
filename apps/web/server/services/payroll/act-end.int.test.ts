import {
  assignment,
  company,
  contract,
  payee,
  payrollItem,
  payrollLine,
  period,
  person,
  supplierAct,
} from '@tally/db/schema';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { ensureMonthlyActDraft, splitActByActivity } from '../acts';
import { setPayoutRate } from '.';

// September 2049 is paid in parts after the client pays: its last act runs into October (A-098).
const h = intHarness('2049-10-12');
let finance: Awaited<ReturnType<typeof h.user>>;
const ids = {
  company: '',
  person: '',
  payee: '',
  contract: '',
  assignments: [] as string[],
  periods: [] as string[],
  items: [] as string[],
  lines: [] as string[],
};

beforeAll(async () => {
  finance = await h.user('finance');
  const [co] = await h.db
    .insert(company)
    .values({ nameEn: 'Act end', nameUa: 'Кінець' })
    .returning();
  const [p] = await h.db.insert(person).values({ fullName: 'Act End Person' }).returning();
  const [fop] = await h.db
    .insert(payee)
    .values({ kind: 'fop', legalNameUa: 'ФОП Кінець', personId: p?.id ?? null })
    .returning();
  const [ct] = await h.db
    .insert(contract)
    .values({ kind: 'fop', number: 'OD-9049', companyId: co?.id ?? '', payeeId: fop?.id ?? null })
    .returning();
  Object.assign(ids, { company: co?.id, person: p?.id, payee: fop?.id, contract: ct?.id });
  for (const roleTitle of ['Boosty', 'CTO']) {
    const [a] = await h.db
      .insert(assignment)
      .values({ personId: ids.person, isInternal: true, startsOn: '2049-01-01', roleTitle })
      .returning();
    ids.assignments.push(a?.id ?? '');
  }
  for (const month of ['2049-09-01', '2049-10-01']) {
    const [per] = await h.db.insert(period).values({ month, workHours: '176' }).returning();
    ids.periods.push(per?.id ?? '');
    const [item] = await h.db
      .insert(payrollItem)
      .values({
        periodId: per?.id ?? '',
        personId: ids.person,
        payoutMethod: 'fiat',
        payeeId: ids.payee,
        totalUsd: '5000',
      })
      .returning();
    ids.items.push(item?.id ?? '');
    const lines = await h.db
      .insert(payrollLine)
      .values(
        ids.assignments.map((assignmentId, n) => ({
          payrollItemId: item?.id ?? '',
          assignmentId,
          amount: n === 0 ? '4000' : '1000',
          status: 'payable' as const,
          fundingSource: 'company' as const,
        })),
      )
      .returning();
    if (month === '2049-09-01') ids.lines.push(...lines.map((l) => l.id));
    await h.db.execute(sql`select public.refresh_payroll_item(${item?.id ?? ''})`);
  }
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(supplierAct).where(eq(supplierAct.contractId, ids.contract));
      await tx.delete(payrollLine).where(inArray(payrollLine.payrollItemId, ids.items));
      await tx.delete(payrollItem).where(inArray(payrollItem.id, ids.items));
    });
    await db.delete(period).where(inArray(period.id, ids.periods));
    await db.delete(assignment).where(inArray(assignment.id, ids.assignments));
    await db.delete(contract).where(eq(contract.id, ids.contract));
    await db.delete(payee).where(eq(payee.id, ids.payee));
    await db.delete(person).where(eq(person.id, ids.person));
    await db.delete(company).where(eq(company.id, ids.company));
  }),
);

const actsOf = (itemId: string) =>
  h.db
    .select()
    .from(supplierAct)
    .where(eq(supplierAct.payrollItemId, itemId))
    .orderBy(asc(supplierAct.periodFrom));

describe('the last act of a payout runs on past its month (A-098)', () => {
  it('splits September into 01.09–30.09 and 01.10–10.10', async () => {
    const [september = '', october = ''] = ids.items;
    for (const itemId of ids.items) {
      await setPayoutRate.run(h.ctxFor(finance), { itemId, rate: '41.5' });
      await h.db.transaction((tx) => ensureMonthlyActDraft(tx, itemId));
    }
    const [whole] = await actsOf(september);
    const split = await splitActByActivity.run(h.ctxFor(finance), {
      actId: whole?.id ?? '',
      lineIds: [ids.lines[0] ?? ''],
      periodFrom: '2049-10-01',
      periodTo: '2049-10-10',
      periodEnd: '2049-10-10',
    });
    expect(split.isOk()).toBe(true);
    const acts = await actsOf(september);
    expect(acts).toMatchObject([
      { periodFrom: '2049-09-01', periodTo: '2049-09-30', amountUsd: null },
      { periodFrom: '2049-10-01', periodTo: '2049-10-10', amountUsd: '4000.00000000' },
    ]);
    const last = acts[1];
    expect(last?.actDate && last.actDate >= '2049-10-01' && last.actDate <= '2049-10-10').toBe(
      true,
    );

    // October's own act has the same work: the September act running into October is September's.
    const [octoberAct] = await actsOf(october);
    await expect(
      h.db
        .update(supplierAct)
        .set({ assignmentIds: [ids.assignments[0] ?? ''] })
        .where(eq(supplierAct.id, octoberAct?.id ?? '')),
    ).resolves.toBeDefined();
  });

  it('runs on only the last act, not before its end, and not past three months', async () => {
    const [september = '', october = ''] = ids.items;
    const [rest] = await actsOf(september);
    const [whole] = await actsOf(october);
    const split = (
      actId: string,
      range: { periodFrom: string; periodTo: string; periodEnd: string },
    ) => splitActByActivity.run(h.ctxFor(finance), { actId, amountUsd: '100', ...range });
    const message = async (r: ReturnType<typeof split>) => (await r)._unsafeUnwrapErr().message;
    expect(
      await message(
        split(rest?.id ?? '', {
          periodFrom: '2049-09-01',
          periodTo: '2049-09-10',
          periodEnd: '2049-10-20',
        }),
      ),
    ).toBe('acts.splitEndLastOnly');
    expect(
      await message(
        split(whole?.id ?? '', {
          periodFrom: '2049-10-01',
          periodTo: '2049-10-10',
          periodEnd: '2049-10-20',
        }),
      ),
    ).toBe('acts.splitEndBeforeAct');
    expect(
      await message(
        split(whole?.id ?? '', {
          periodFrom: '2049-10-01',
          periodTo: '2049-10-10',
          periodEnd: '2050-02-15',
        }),
      ),
    ).toContain('acts.splitEndTooLate');
    expect(
      (
        await split(whole?.id ?? '', {
          periodFrom: '2049-11-01',
          periodTo: '2049-11-12',
          periodEnd: '2049-11-12',
        })
      ).isOk(),
    ).toBe(true);
  });
});
