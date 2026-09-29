import { numberSequence, workCalendarException } from '@tally/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import {
  deleteCalendarException,
  listCalendarExceptions,
  listSequences,
  saveCalendarException,
  saveSequence,
} from '.';

const h = intHarness('2038-03-02');
const KEY = 'test:int-settings';
const DAY = '2038-08-24';
let owner: Awaited<ReturnType<typeof h.user>>;
let finance: Awaited<ReturnType<typeof h.user>>;

beforeAll(async () => {
  owner = await h.user('owner');
  finance = await h.user('finance');
});

afterAll(() =>
  h.cleanup(async (db) => {
    await db.delete(workCalendarException).where(eq(workCalendarException.onDate, DAY));
    await db.delete(numberSequence).where(eq(numberSequence.key, KEY));
  }),
);

describe('settings: calendar and numbering (5.5, 5.6)', () => {
  it('lets the owner add, replace and remove a calendar exception', async () => {
    const add = await saveCalendarException.run(h.ctxFor(owner), {
      onDate: DAY,
      reason: 'День Незалежності',
    });
    expect(add.isOk()).toBe(true);
    await saveCalendarException.run(h.ctxFor(owner), {
      onDate: DAY,
      isWorking: 'on',
      reason: 'Перенесення',
    });
    const rows = (await listCalendarExceptions.run(h.ctxFor(finance), {}))._unsafeUnwrap();
    expect(rows.find((r) => r.onDate === DAY)).toMatchObject({
      isWorking: true,
      reason: 'Перенесення',
    });
    expect((await deleteCalendarException.run(h.ctxFor(owner), { onDate: DAY })).isOk()).toBe(true);
  });

  it('forbids finance from changing the calendar', async () => {
    const res = await saveCalendarException.run(h.ctxFor(finance), { onDate: DAY, reason: 'x' });
    expect(res._unsafeUnwrapErr().code).toBe('forbidden');
  });

  it('creates a sequence, shows the next number and never lowers the counter', async () => {
    const created = await saveSequence.run(h.ctxFor(owner), {
      key: KEY,
      template: 'Z{seq}/{yy}',
      nextValue: '5',
      yearScoped: 'on',
    });
    expect(created.isOk()).toBe(true);
    const list = (await listSequences.run(h.ctxFor(finance), {}))._unsafeUnwrap();
    expect(list.find((s) => s.key === KEY)?.nextNumber).toBe('Z5/38');

    const lower = await saveSequence.run(h.ctxFor(owner), {
      key: KEY,
      template: 'Z{seq}/{yy}',
      nextValue: '4',
      yearScoped: 'on',
    });
    expect(lower._unsafeUnwrapErr().message).toContain('не можна зменшити');

    const bad = await saveSequence.run(h.ctxFor(owner), {
      key: KEY,
      template: 'Z',
      nextValue: '6',
    });
    expect(bad._unsafeUnwrapErr().fieldErrors?.template).toBeDefined();
  });
});
