import type { DbTransaction } from '@tally/db';
import { ledgerImport, transaction } from '@tally/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { err, ok, type Result } from 'neverthrow';
import { z } from 'zod';
import type { ServiceContext } from '../../context';
import { inActorScopeAtomic } from '../../atomic';
import { defineService } from '../../define-service';
import { msg, serviceError, type ServiceError } from '../../errors';
import { TWO_LEG_TYPES } from '..';
import { addTransactionItems, type transactionItem } from '../batch';
import { accountsOf } from './prepare';
import { decision, importRows, isBookable, type Decision, type ImportRow } from './rows';

type Item = z.output<typeof transactionItem>;

const decisions = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}, z.array(decision).max(2000));

type Plan = {
  items: Item[];
  itemKeys: string[];
  links: { key: string; id: string; externalRef: string }[];
  /** Every row booked or linked, legs and fees included. */
  touched: string[];
};

const rowError = (errors: Record<string, string[]>, key: string, message: string) => {
  (errors[`rows.${key}`] ??= []).push(message);
};

/**
 * Turns rows + the person's choices into Ledger batch items (mcp-agent-guide 7.4): an attached
 * credit is the `to` leg of the exchange or transfer, an attached debit with a fee purpose its
 * `fee`; descriptions keep the attached references (`credit ref …`, `fee ref …`) so the bank
 * rows are recognised on the next import. Pure, so the rules are tested without a DB.
 */
export function planCommit(
  rows: readonly ImportRow[],
  chosen: readonly Decision[],
): Result<Plan, Record<string, string[]>> {
  const errors: Record<string, string[]> = {};
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const decisionOf = new Map(chosen.map((d) => [d.key, d]));
  for (const d of chosen) {
    if (!byKey.has(d.key)) rowError(errors, d.key, 'import.unknownRow');
  }
  const included = rows.filter((r) => decisionOf.get(r.key)?.include && isBookable(r));
  const attached = new Map<string, ImportRow[]>();
  for (const r of included) {
    const target = decisionOf.get(r.key)?.attachTo;
    if (!target) continue;
    const main = byKey.get(target);
    // A matched row already exists in the Ledger: as a leg of another row it would count twice.
    if (
      !main ||
      r.status === 'match' ||
      main.status === 'match' ||
      !isBookable(main) ||
      !decisionOf.get(target)?.include ||
      decisionOf.get(target)?.attachTo
    ) {
      rowError(errors, r.key, 'import.attachTarget');
      continue;
    }
    attached.set(target, [...(attached.get(target) ?? []), r]);
  }

  const plan: Plan = { items: [], itemKeys: [], links: [], touched: [] };
  for (const row of included) {
    const d = decisionOf.get(row.key);
    if (!d || d.attachTo) continue;
    if (row.status === 'match') {
      if (row.existingId)
        plan.links.push({ key: row.key, id: row.existingId, externalRef: row.externalRef });
      continue;
    }
    const extra = attached.get(row.key) ?? [];
    const counters = extra.filter((r) => r.direction !== row.direction);
    const fees = extra.filter((r) => r.direction === 'out' && r.direction === row.direction);
    const strays = extra.filter((r) => r.direction === 'in' && r.direction === row.direction);
    for (const r of strays) rowError(errors, r.key, 'import.attachTarget');
    if (counters.length > 1) rowError(errors, row.key, 'import.oneCounter');
    if (fees.length + (row.fee ? 1 : 0) > 1) rowError(errors, row.key, 'import.oneFee');
    const counter = counters[0];
    const twoLeg = TWO_LEG_TYPES.includes(d.type);
    if (counter && !twoLeg) rowError(errors, row.key, 'import.needsTwoLegType');
    if (!counter && twoLeg) rowError(errors, row.key, 'import.needsCounter');
    if (!counter && d.type === 'revenue' && row.direction !== 'in')
      rowError(errors, row.key, 'import.revenueIsIn');
    if (!counter && d.type === 'expense' && row.direction !== 'out')
      rowError(errors, row.key, 'import.expenseIsOut');
    if (!counter && !['revenue', 'expense'].includes(d.type))
      rowError(errors, row.key, 'import.needsCounter');
    if (!d.categoryId) rowError(errors, row.key, 'ledger.chooseCategory');
    if (d.personId && d.clientId) rowError(errors, row.key, 'ledger.oneParty');
    if (errors[`rows.${row.key}`] || !d.categoryId) continue;

    const legOf = (r: ImportRow) => ({ account: r.accountId, amount: r.amount });
    const out = row.direction === 'out' ? row : counter;
    const into = row.direction === 'in' ? row : counter;
    const fee = row.fee
      ? { account: row.fee.accountId, amount: row.fee.amount }
      : fees[0] && legOf(fees[0]);
    const refOf = (r: ImportRow) => r.ref ?? r.externalRef;
    const description = [
      d.description?.trim() || row.purpose,
      counter && !row.network ? `credit ref ${refOf(counter)}` : null,
      fees[0] ? `fee ref ${refOf(fees[0])}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    plan.items.push({
      externalRef: row.externalRef,
      occurredOn: row.occurredOn as Item['occurredOn'],
      type: d.type,
      category: d.categoryId,
      description: description || null,
      counterparty: row.counterparty,
      ...(d.personId ? { personId: d.personId } : {}),
      ...(d.clientId ? { clientId: d.clientId } : {}),
      counterpartyAddress: counter ? null : row.counterpartyAddress,
      ...(out ? { from: legOf(out) } : {}),
      ...(into ? { to: legOf(into) } : {}),
      ...(fee ? { fee } : {}),
    });
    plan.itemKeys.push(row.key);
  }
  plan.touched = included.map((r) => r.key);
  return Object.keys(errors).length ? err(errors) : ok(plan);
}

async function linkExisting(
  tx: DbTransaction,
  links: Plan['links'],
  errors: Record<string, string[]>,
) {
  for (const l of links) {
    const updated = await tx
      .update(transaction)
      .set({ externalRef: l.externalRef })
      .where(and(eq(transaction.id, l.id), isNull(transaction.externalRef)))
      .returning({ id: transaction.id });
    if (!updated.length) rowError(errors, l.key, 'import.linkTaken');
  }
}

const failure = (errors: Record<string, string[]>): ServiceError =>
  serviceError(
    'validation_error',
    msg('import.rowsFailed', { count: Object.keys(errors).length }),
    errors,
  );

/**
 * Books a reviewed import (A-121, A-122) in one DB transaction: new rows through the Ledger batch
 * service (I4/I5 per item, references de-duplicated again), matched rows get their reference,
 * and the import becomes committed. Any error rolls everything back; a second commit of the
 * same import (double click, two tabs, two people) waits for the first and is then refused.
 */
export const commitImport = defineService({
  name: 'ledger.import.commit',
  input: z.object({ importId: z.uuid(), decisions, dryRun: z.boolean().default(false) }),
  handler: (ctx: ServiceContext, input) =>
    inActorScopeAtomic(ctx, input, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tally.ledger_import'))`);
      const [draft] = await tx
        .select()
        .from(ledgerImport)
        .where(eq(ledgerImport.id, input.importId))
        .for('update');
      if (!draft) return err(serviceError('not_found', 'import.notFound'));
      if (draft.status !== 'draft') return err(serviceError('conflict', 'import.notDraft'));
      const rows = importRows.parse(draft.rows);
      const planned = planCommit(rows, input.decisions);
      if (planned.isErr()) return err(failure(planned.error));
      const { items, itemKeys, links } = planned.value;
      if (!items.length && !links.length)
        return err(serviceError('validation_error', 'import.nothingChosen'));

      const errors: Record<string, string[]> = {};
      await linkExisting(tx, links, errors);
      let created = 0;
      let duplicates = 0;
      const ids: string[] = [];
      for (let start = 0; start < items.length; start += 500) {
        const booked = await addTransactionItems(tx, items.slice(start, start + 500));
        if (booked.isErr()) {
          for (const [field, messages] of Object.entries(booked.error.fieldErrors ?? {})) {
            const index = Number(field.split('.')[1]);
            const key = itemKeys[start + index];
            if (key) for (const m of messages) rowError(errors, key, m);
          }
          if (!booked.error.fieldErrors) return err(booked.error);
          continue;
        }
        created += booked.value.created;
        duplicates += booked.value.duplicates;
        ids.push(...booked.value.transactions.map((t) => t.id));
      }
      if (Object.keys(errors).length) return err(failure(errors));

      const summary = {
        ...(draft.summary as object),
        created,
        duplicates,
        linked: links.length,
        transactionIds: ids,
        decisions: input.decisions.filter((d) => d.include).length,
      };
      await tx
        .update(ledgerImport)
        .set({
          status: 'committed',
          committedAt: sql`now()`,
          committedBy: ctx.actor.kind === 'user' ? ctx.actor.userId : null,
          summary,
        })
        .where(eq(ledgerImport.id, draft.id));
      const touched = new Set(planned.value.touched);
      return ok({
        created,
        duplicates,
        linked: links.length,
        accounts: accountsOf(rows.filter((r) => touched.has(r.key))),
      });
    }),
});
