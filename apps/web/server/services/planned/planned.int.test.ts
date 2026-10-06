import { category, plannedExpense, plannedPayment } from '@tally/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { deletePlannedExpense, listPlannedExpenses, savePlannedExpense } from '.';

const h = intHarness('2041-10-15');
let finance: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;
let categoryId = '';
const ids: string[] = [];

beforeAll(async () => {
  finance = await h.user('finance');
  viewer = await h.user('viewer');
  const [c] = await h.db
    .select()
    .from(category)
    .where(and(eq(category.txType, 'expense'), eq(category.name, 'Legal / Accounting')));
  categoryId = c?.id ?? '';
});

afterAll(() =>
  h.cleanup(async (db) => {
    if (ids.length) {
      await db.delete(plannedPayment).where(inArray(plannedPayment.plannedExpenseId, ids));
      await db.delete(plannedExpense).where(inArray(plannedExpense.id, ids));
    }
  }),
);

describe('planned expenses (6.1, A-067)', () => {
  it('saves monthly and yearly plans and shows the next date', async () => {
    const accountant = await savePlannedExpense.run(h.ctxFor(finance), {
      name: 'Int accountant',
      categoryId,
      amount: '12000',
      currency: 'UAH',
      frequency: 'monthly',
      anchorMonth: '4',
      dueDay: '10',
      startsOn: '2041-01',
      endsOn: '',
    });
    ids.push(accountant._unsafeUnwrap().id);
    const domain = await savePlannedExpense.run(h.ctxFor(finance), {
      name: 'Int domain',
      categoryId,
      amount: '40',
      currency: 'USD',
      frequency: 'yearly',
      anchorMonth: '3',
      dueDay: '',
      startsOn: '2041-01',
    });
    ids.push(domain._unsafeUnwrap().id);

    const rows = (await listPlannedExpenses.run(h.ctxFor(finance), {}))._unsafeUnwrap();
    const byName = (n: string) => rows.find((r) => r.expense.name === n);
    expect(byName('Int accountant')).toMatchObject({
      nextOn: '2041-11-10',
      expense: { anchorMonth: null, startsOn: '2041-01-01' },
    });
    expect(byName('Int domain')?.nextOn).toBe('2042-03-01');
    expect((await listPlannedExpenses.run(h.ctxFor(viewer), {}))._unsafeUnwrap()).toHaveLength(0);
  });

  it('rejects a yearly plan without its month and deletes a plan', async () => {
    const noMonth = await savePlannedExpense.run(h.ctxFor(finance), {
      name: 'Int no month',
      categoryId,
      amount: '1',
      currency: 'USD',
      frequency: 'yearly',
      startsOn: '2041-01',
    });
    expect(noMonth._unsafeUnwrapErr().fieldErrors?.anchorMonth).toBeDefined();
    const id = ids.pop() ?? '';
    expect((await deletePlannedExpense.run(h.ctxFor(finance), { id })).isOk()).toBe(true);
    expect((await deletePlannedExpense.run(h.ctxFor(finance), { id })).isErr()).toBe(true);
  });
});
