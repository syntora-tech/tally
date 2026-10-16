'use client';

import { parseDecimal, toDecimal } from '@tally/domain';
import { cn } from 'cn';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDialogScope } from '@/components/v2/form-dialog';
import { useFormat } from '@/lib/format';
import { allocatePaymentsAction } from '@/server/actions/invoices';
import { linkTargetsAction } from '@/server/actions/ledger';
import { payPlannedAction } from '@/server/actions/planned';
import { payReimbursementsAction } from '@/server/actions/trips';
import type { ActionResult } from '@/server/actions/to-action-result';
import type { LinkTargets } from '@/server/services/allocations/link-targets';

type Kind = 'invoice' | 'planned' | 'payout' | 'reimbursement';
type Pick = { id: string; amount: string; rate: string };
type MultiRow = {
  id: string;
  label: string;
  remaining: string;
  currency: string;
  needsRate: boolean;
  match: boolean;
};
type State = ActionResult<unknown> | null;

const smaller = (a: string, b: string) => (toDecimal(a).lte(toDecimal(b)) ? a : b);

/**
 * "Прив'язати…" on a Ledger row (A-106): what the transaction pays, picked from the targets the
 * other pages would offer it to. Linking runs the same actions as those pages; a payout opens its
 * own pay dialog on the payroll page, which owns the rate, the acts and the signatures.
 */
export function LinkTransaction({ transactionId }: { transactionId: string }) {
  const t = useTranslations('ledgerLink');
  const fmt = useFormat();
  const dialog = useDialogScope();
  const [targets, setTargets] = useState<LinkTargets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [picked, setPicked] = useState('');
  // One payment can cover several invoices or reimbursements: what is ticked, in that order.
  const [split, setSplit] = useState<Pick[]>([]);

  useEffect(() => {
    let live = true;
    void linkTargetsAction(transactionId).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setLoadError(r.error.message);
        return;
      }
      setTargets(r.data);
      const first = (
        [
          ['invoice', r.data.invoices],
          ['planned', r.data.planned],
          ['payout', r.data.payouts],
          ['reimbursement', r.data.reimbursements],
        ] as const
      ).find(([, rows]) => rows.length > 0);
      if (first) setKind(first[0]);
    });
    return () => {
      live = false;
    };
  }, [transactionId]);

  const [state, action, pending] = useActionState<State, FormData>(async (prev, formData) => {
    const run =
      kind === 'invoice'
        ? allocatePaymentsAction
        : kind === 'planned'
          ? payPlannedAction
          : payReimbursementsAction;
    const result = (await run(prev as never, formData)) as State;
    if (result?.ok) {
      toast.success(t('linked'));
      dialog?.close();
    }
    return result;
  }, null);
  const error = state && !state.ok ? state.error : null;

  if (loadError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }
  if (!targets) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('loading')}
      </p>
    );
  }

  const options: Record<Kind, { id: string; label: string; detail: string; match: boolean }[]> = {
    invoice: targets.invoices.map((i) => ({
      id: i.id,
      label: i.label,
      detail: t('left', { amount: fmt.amount(i.remaining, i.currency) }),
      match: i.match,
    })),
    planned: targets.planned.map((p) => ({
      id: p.id,
      label: p.label,
      detail: `${fmt.date(p.dueOn)} · ${fmt.amount(p.amount, targets.currency)}`,
      match: p.match,
    })),
    payout: targets.payouts.map((p) => ({
      id: p.itemId,
      label: p.label,
      detail: [
        fmt.month(p.month),
        p.remaining !== null && t('left', { amount: fmt.amount(p.remaining, p.currency) }),
      ]
        .filter(Boolean)
        .join(' · '),
      match: p.match,
    })),
    reimbursement: targets.reimbursements.map((r) => ({
      id: r.id,
      label: r.label,
      detail: t('left', { amount: fmt.amount(r.remaining, 'UAH') }),
      match: r.match,
    })),
  };
  const kinds = (Object.keys(options) as Kind[]).filter((k) => options[k].length > 0);
  if (!kind || kinds.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        {t(targets.type === 'revenue' ? 'nothingRevenue' : 'nothingExpense')}
      </p>
    );
  }

  const payout = targets.payouts.find((p) => p.itemId === picked);
  const multi = kind === 'invoice' || kind === 'reimbursement';
  const rows: MultiRow[] =
    kind === 'invoice'
      ? targets.invoices
      : targets.reimbursements.map((r) => ({ ...r, currency: 'UAH', needsRate: false }));
  const num = (v: string) => parseDecimal(v.replace(/\s/g, '').replace(',', '.'));
  // In the transaction's currency: a foreign-currency invoice counts at its rate once one is typed.
  const splitTotal = split.reduce((s, x) => {
    const v = num(x.amount);
    if (v.isErr()) return s;
    if (!rows.find((r) => r.id === x.id)?.needsRate) return s.plus(v.value);
    const rate = num(x.rate);
    return rate.isOk() ? s.plus(v.value.times(rate.value)) : s;
  }, toDecimal('0'));
  const toggle = (row: MultiRow) => {
    if (split.some((x) => x.id === row.id)) {
      setSplit(split.filter((x) => x.id !== row.id));
      return;
    }
    // What is still free after the ticked ones, up to what this one still needs.
    const left = toDecimal(targets.free).minus(splitTotal);
    const amount =
      !row.needsRate && left.gt(0) ? smaller(left.toFixed(2), row.remaining) : row.remaining;
    setSplit([...split, { id: row.id, amount, rate: '' }]);
  };
  const change = (id: string, patch: Partial<Pick>) => {
    setSplit(split.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const items = split.map((x) =>
    kind === 'invoice'
      ? { invoiceId: x.id, amount: x.amount, fxRate: x.rate }
      : { reimbursementId: x.id, amount: x.amount },
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t('free', { amount: fmt.amount(targets.free, targets.currency) })}
      </p>
      <input type="hidden" name="transactionId" value={transactionId} />
      {kinds.length > 1 && (
        <div
          role="radiogroup"
          aria-label={t('what')}
          className="inline-flex flex-wrap gap-1 self-start rounded-lg bg-muted p-1"
        >
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setPicked('');
                setSplit([]);
              }}
              className={cn(
                'h-8 rounded-md px-3 text-[13px] font-medium',
                kind === k
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`kind.${k}`)}
            </button>
          ))}
        </div>
      )}
      {multi ? (
        <div
          role="group"
          aria-label={t(`kind.${kind}`)}
          className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border"
        >
          <input type="hidden" name="items" value={JSON.stringify(items)} />
          {rows.map((r) => {
            const on = split.find((x) => x.id === r.id);
            return (
              <div
                key={r.id}
                className={cn(
                  'flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm',
                  on && 'bg-muted',
                )}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={!!on}
                    onChange={() => {
                      toggle(r);
                    }}
                    className="accent-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('left', { amount: fmt.amount(r.remaining, r.currency) })}
                    </span>
                  </span>
                </label>
                {r.match && !on && (
                  <span className="rounded bg-success px-1.5 text-xs text-success-foreground">
                    {t('match')}
                  </span>
                )}
                {on && (
                  <span className="flex items-center gap-2">
                    {r.needsRate && (
                      <Input
                        aria-label={t('rateFor', { name: r.label })}
                        placeholder={t('rate')}
                        inputMode="decimal"
                        required
                        value={on.rate}
                        onChange={(e) => {
                          change(r.id, { rate: e.target.value });
                        }}
                        className="h-9 w-24 text-right"
                      />
                    )}
                    <Input
                      aria-label={t('amountFor', { name: r.label })}
                      inputMode="decimal"
                      value={on.amount}
                      onChange={(e) => {
                        change(r.id, { amount: e.target.value });
                      }}
                      className="h-9 w-32 text-right"
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={t(`kind.${kind}`)}
          className="flex max-h-72 flex-col divide-y overflow-y-auto rounded-lg border"
        >
          {options[kind].map((o) => (
            <label
              key={o.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50',
                picked === o.id && 'bg-muted',
              )}
            >
              <input
                type="radio"
                name="id"
                value={o.id}
                checked={picked === o.id}
                onChange={() => {
                  setPicked(o.id);
                }}
                className="accent-foreground"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.detail}</span>
              </span>
              {o.match && (
                <span className="rounded bg-success px-1.5 text-xs text-success-foreground">
                  {t('match')}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      {multi && split.length > 0 && (
        <p
          className={cn(
            'text-right text-sm',
            splitTotal.gt(toDecimal(targets.free)) ? 'text-destructive' : 'text-muted-foreground',
          )}
          data-testid="split-total"
        >
          {t('splitTotal', {
            total: fmt.amount(splitTotal.toFixed(2), targets.currency),
            free: fmt.amount(targets.free, targets.currency),
          })}
        </p>
      )}

      {kind === 'payout' && <p className="text-sm text-muted-foreground">{t('payoutHint')}</p>}

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2 border-t pt-4">
        {kind === 'payout' ? (
          <Button
            disabled={!payout}
            render={
              payout ? (
                <Link
                  href={`/payroll?period=${payout.periodId}&pay=${payout.itemId}&tx=${transactionId}`}
                />
              ) : undefined
            }
          >
            {t('openPayout')}
          </Button>
        ) : (
          <Button type="submit" disabled={pending || (multi ? split.length === 0 : !picked)}>
            {t('link')}
          </Button>
        )}
      </div>
    </form>
  );
}
