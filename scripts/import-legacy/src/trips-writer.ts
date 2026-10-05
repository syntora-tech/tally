import type { Db } from '@tally/db';
import {
  person,
  reimbursement,
  supplierAct,
  trip,
  tripExpense,
  tripParticipant,
} from '@tally/db/schema';
import { sum } from '@tally/domain';
import { eq, sql } from 'drizzle-orm';
import type { TripsModel } from './trips';
import { upsert, type WriteStats } from './writer';

class DryRunRollback extends Error {}

export type TripsOutcome = {
  stats: WriteStats;
  /** Per trip: reimbursable total and what the imported reimbursement covers, UAH. */
  totals: { sheet: string; dueUah: string; reimbursedUah: string; note: string | null }[];
  problems: string[];
};

/**
 * Writes the trips model as `system:import` (A-070), idempotent via legacy_ref. A trip reimbursed
 * by a legacy FOP act gets a paid `act` reimbursement linked to that act, which becomes type
 * `reimbursement`; a trip known to be reimbursed otherwise gets a paid one with a note.
 */
export async function writeTrips(
  db: Db,
  model: TripsModel,
  options: { dryRun: boolean },
): Promise<TripsOutcome> {
  const stats: WriteStats = {};
  const totals: TripsOutcome['totals'] = [];
  const problems: string[] = [];
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor', 'system:import', true), set_config('app.via', 'import', true)`,
      );
      for (const t of model.trips) {
        const [known] = await tx
          .select({ id: person.id })
          .from(person)
          .where(sql`lower(${person.fullName}) = lower(${t.participant})`);
        const personId =
          known?.id ??
          (await upsert(
            tx,
            person,
            'person',
            `trips:person:${t.participant}`,
            { fullName: t.participant },
            stats,
          ));
        const tripId = await upsert(
          tx,
          trip,
          'trip',
          t.ref,
          { title: t.title, location: t.location, startsOn: t.startsOn, endsOn: t.endsOn },
          stats,
        );
        await tx.insert(tripParticipant).values({ tripId, personId }).onConflictDoNothing();
        for (const e of t.expenses) {
          const { ref, ...values } = e;
          await upsert(
            tx,
            tripExpense,
            'trip_expense',
            ref,
            { ...values, tripId, personId, paidBy: 'person', fxSource: 'manual' },
            stats,
          );
        }
        const dueUah = sum(t.expenses.filter((e) => e.reimbursable).map((e) => e.amountUah));
        let reimbursedUah = '0.00';
        let note: string | null = null;
        if (t.reimbursement && 'act' in t.reimbursement) {
          const number = t.reimbursement.act.replace(/\s+/g, ' ').trim();
          const [act] = await tx
            .select()
            .from(supplierAct)
            .where(sql`regexp_replace(${supplierAct.number}, '\\s+', ' ', 'g') = ${number}`);
          if (!act) {
            problems.push(`${t.sheet}: act "${number}" not found — import the acts registry first`);
          } else {
            const id = await upsert(
              tx,
              reimbursement,
              'reimbursement',
              t.reimbursement.ref,
              {
                tripId,
                personId,
                payeeId: act.payeeId,
                amount: act.amountUah,
                method: 'act',
                status: 'paid',
                notes: `Legacy act ${number}`,
              },
              stats,
            );
            if (act.reimbursementId !== id || act.type !== 'reimbursement') {
              await tx
                .update(supplierAct)
                .set({ type: 'reimbursement', reimbursementId: id })
                .where(eq(supplierAct.id, act.id));
            }
            reimbursedUah = act.amountUah;
            note = `act ${number}`;
          }
        } else if (t.reimbursement && dueUah.gt(0)) {
          await upsert(
            tx,
            reimbursement,
            'reimbursement',
            t.reimbursement.ref,
            {
              tripId,
              personId,
              amount: dueUah.toFixed(2),
              method: 'direct_payment',
              status: 'paid',
              notes: t.reimbursement.note,
            },
            stats,
          );
          reimbursedUah = dueUah.toFixed(2);
          note = t.reimbursement.note;
        }
        totals.push({ sheet: t.sheet, dueUah: dueUah.toFixed(2), reimbursedUah, note });
      }
      if (options.dryRun) {
        await tx.execute(sql`set constraints all immediate`);
        throw new DryRunRollback();
      }
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return { stats, totals, problems };
}
