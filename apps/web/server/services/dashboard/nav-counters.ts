import { period } from '@tally/db/schema';
import { startOfMonth } from '@tally/domain';
import { and, count, eq, lt } from 'drizzle-orm';
import { ok } from 'neverthrow';
import { z } from 'zod';
import { navItemsFor } from '../../../lib/navigation';
import { actsRegistry } from '../acts/registry';
import { inActorScope } from '../context';
import { defineService } from '../define-service';
import { documentChecks, documentInbox } from '../documents/structure';
import { dashboardOverview } from './overview';

/** `count: null` is a dot: worth a look, nothing to count. `urgent` is something already late. */
export type NavCounter = { count: number | null; urgent: boolean };

/**
 * Sidebar counters (A-105): each one restates a figure its own page already shows, so the two
 * never disagree. Zero means no counter; modules the role cannot open are skipped.
 */
export const navCounters = defineService({
  name: 'dashboard.navCounters',
  input: z.object({}),
  handler: async (ctx) => {
    const role = ctx.actor.kind === 'user' ? ctx.actor.role : null;
    const visible = new Set(role ? navItemsFor(role).map((i) => i.href) : []);
    const out: Record<string, NavCounter> = {};
    const put = (href: string, n: number, urgent: boolean, dot = false) => {
      if (visible.has(href) && n > 0) out[href] = { count: dot ? null : n, urgent };
    };

    const [overview, registry, inbox, checks, openBefore] = await Promise.all([
      dashboardOverview.run(ctx, {}),
      visible.has('/acts')
        ? actsRegistry.run(ctx, { payeeId: '', year: ctx.today.slice(0, 4), all: false })
        : null,
      documentInbox.run(ctx, {}),
      documentChecks.run(ctx, {}),
      visible.has('/periods')
        ? inActorScope(ctx, (tx) =>
            tx
              .select({ n: count() })
              .from(period)
              .where(and(eq(period.status, 'open'), lt(period.month, startOfMonth(ctx.today)))),
          )
        : [],
    ]);

    if (overview.isOk()) {
      const o = overview.value;
      put('/dashboard', o.shortfallOn ? 1 : 0, true, true);
      put('/invoices', o.receivables.filter((r) => r.daysPastDue > 0).length, true);
      put('/payroll', o.events.filter((e) => e.kind === 'payable_now').length, false);
      // Planned events are pulled to today when their date has passed, so `on === today` is
      // everything due today or overdue.
      put(
        '/ledger',
        o.events.filter((e) => e.kind === 'planned' && e.on === ctx.today).length,
        true,
      );
    }
    put('/periods', openBefore[0]?.n ?? 0, false, true);
    if (registry?.isOk()) {
      put('/acts', registry.value.groups.filter((g) => g.missing.length > 0).length, false);
    }
    const inboxCount = inbox.isOk() ? inbox.value.length : 0;
    if (inboxCount > 0) put('/documents', inboxCount, false);
    else if (checks.isOk()) {
      const c = checks.value;
      put(
        '/documents',
        c.contractsWithoutFile.length +
          c.annexesWithoutFile.length +
          c.payeesWithoutContract.length +
          c.duplicateNumbers.length,
        false,
        true,
      );
    }
    return ok(out);
  },
});
