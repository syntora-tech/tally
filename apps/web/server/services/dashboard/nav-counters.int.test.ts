import { period } from '@tally/db/schema';
import { and, eq, lt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intHarness } from '../../../test/int-helpers';
import { actsRegistry } from '../acts/registry';
import { documentChecks, documentInbox } from '../documents/structure';
import { navCounters } from './nav-counters';
import { dashboardOverview } from './overview';

const h = intHarness();
let owner: Awaited<ReturnType<typeof h.user>>;
let viewer: Awaited<ReturnType<typeof h.user>>;

beforeAll(async () => {
  owner = await h.user('owner');
  viewer = await h.user('viewer');
});
afterAll(() => h.cleanup());

describe('navCounters', () => {
  it('restates the figures of the pages it points to', async () => {
    const ctx = h.ctxFor(owner);
    const counters = (await navCounters.run(ctx, {}))._unsafeUnwrap();
    const o = (await dashboardOverview.run(ctx, {}))._unsafeUnwrap();
    const overdue = o.receivables.filter((r) => r.daysPastDue > 0).length;
    const payable = o.events.filter((e) => e.kind === 'payable_now').length;
    const planned = o.events.filter((e) => e.kind === 'planned' && e.on === ctx.today).length;
    const registry = (
      await actsRegistry.run(ctx, { payeeId: '', year: ctx.today.slice(0, 4), all: false })
    )._unsafeUnwrap();
    const gaps = registry.groups.filter((g) => g.missing.length > 0).length;
    const inbox = (await documentInbox.run(ctx, {}))._unsafeUnwrap().length;
    const checks = (await documentChecks.run(ctx, {}))._unsafeUnwrap();
    const checkCount =
      checks.contractsWithoutFile.length +
      checks.annexesWithoutFile.length +
      checks.payeesWithoutContract.length +
      checks.duplicateNumbers.length;
    const openBefore = await h.db
      .select({ id: period.id })
      .from(period)
      .where(and(eq(period.status, 'open'), lt(period.month, `${ctx.today.slice(0, 7)}-01`)));

    expect(counters['/dashboard']).toEqual(
      o.shortfallOn ? { count: null, urgent: true } : undefined,
    );
    expect(counters['/invoices']).toEqual(overdue ? { count: overdue, urgent: true } : undefined);
    expect(counters['/payroll']).toEqual(payable ? { count: payable, urgent: false } : undefined);
    expect(counters['/ledger']).toEqual(planned ? { count: planned, urgent: true } : undefined);
    expect(counters['/acts']).toEqual(gaps ? { count: gaps, urgent: false } : undefined);
    expect(counters['/periods']).toEqual(
      openBefore.length ? { count: null, urgent: false } : undefined,
    );
    expect(counters['/documents']).toEqual(
      inbox
        ? { count: inbox, urgent: false }
        : checkCount
          ? { count: null, urgent: false }
          : undefined,
    );
    for (const c of Object.values(counters)) expect(c.count).not.toBe(0);
  });

  it('skips the modules a viewer cannot open', async () => {
    const counters = (await navCounters.run(h.ctxFor(viewer), {}))._unsafeUnwrap();
    for (const href of ['/invoices', '/payroll', '/periods', '/acts', '/ledger']) {
      expect(counters[href]).toBeUndefined();
    }
  });
});
