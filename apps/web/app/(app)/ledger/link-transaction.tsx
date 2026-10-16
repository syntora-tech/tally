'use client';

import { parseDecimal, toDecimal } from '@tally/domain';
import { cn } from 'cn';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDialogScope } from '@/components/v2/form-dialog';
import { useFormat } from '@/lib/format';
import { allocatePaymentAction } from '@/server/actions/invoices';
import { linkTargetsAction } from '@/server/actions/ledger';
import { payPlannedAction } from '@/server/actions/planned';
import { payReimbursementsAction } from '@/server/actions/trips';
import type { ActionResult } from '@/server/actions/to-action-result';
import type { LinkTargets } from '@/server/services/allocations/link-targets';

type Kind = 'invoice' | 'planned' | 'payout' | 'reimbursement';
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
  // Several reimbursements can share one expense (A-108): id → amount, in the order ticked.
  const [split, setSplit] = useState<{ id: string; amount: string }[]>([]);

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
        ? allocatePaymentAction
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

  const invoice = targets.invoices.find((i) => i.id === picked);
  const payout = targets.payouts.find((p) => p.itemId === picked);
  const amountDefault =
    kind === 'invoice' && invoice
      ? invoice.needsRate
        ? invoice.remaining
        : smaller(targets.free, invoice.remaining)
      : '';
  const splitTotal = split.reduce((s, x) => {
    const v = parseDecimal(x.amount.replace(',', '.'));
    return v.isOk() ? s.plus(v.value) : s;
  }, toDecimal('0'));
  const toggle = (id: string, remaining: string) => {
    if (split.some((x) => x.id === id)) {
      setSplit(split.filter((x) => x.id !== id));
      return;
    }
    // What is still free after the ticked ones, up to what this reimbursement still needs.
    const left = toDecimal(targets.free).minus(splitTotal);
    const amount = left.gt(0) ? smaller(left.toFixed(2), remaining) : remaining;
    setSplit([...split, { id, amount }]);
  };

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
      {kind === 'reimbursement' ? (
        <div
          role="group"
          aria-label={t('kind.reimbursement')}
          className="flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border"
        >
          <input
            type="hidden"
            name="items"
            value={JSON.stringify(split.map((x) => ({ reimbursementId: x.id, amount: x.amount })))}
          />
          {targets.reimbursements.map((r) => {
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
                      toggle(r.id, r.remaining);
                    }}
                    className="accent-foreground"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('left', { amount: fmt.amount(r.remaining, 'UAH') })}
                    </span>
                  </span>
                </label>
                {r.match && !on && (
                  <span className="rounded bg-success px-1.5 text-xs text-success-foreground">
                    {t('match')}
                  </span>
                )}
                {on && (
                  <Input
                    aria-label={t('amountFor', { name: r.label })}
                    inputMode="decimal"
                    value={on.amount}
                    onChange={(e) => {
                      setSplit(
                        split.map((x) => (x.id === r.id ? { ...x, amount: e.target.value } : x)),
                      );
                    }}
                    className="h-9 w-32 text-right"
                  />
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
                name={kind === 'invoice' ? 'invoiceId' : 'id'}
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
      {kind === 'reimbursement' && split.length > 0 && (
        <p
          className={cn(
            'text-right text-sm',
            splitTotal.gt(toDecimal(targets.free)) ? 'text-destructive' : 'text-muted-foreground',
          )}
          data-testid="split-total"
        >
          {t('splitTotal', {
            total: fmt.amount(splitTotal.toFixed(2), 'UAH'),
            free: fmt.amount(targets.free, targets.currency),
          })}
        </p>
      )}

      {kind === 'invoice' && picked && (
        <div className="flex flex-wrap gap-3">
          <FormField
            label={t('amountIn', { currency: invoice?.currency ?? '' })}
            htmlFor="link-amount"
            error={error?.fieldErrors?.amount}
          >
            <Input
              id="link-amount"
              key={picked}
              name="amount"
              inputMode="decimal"
              defaultValue={amountDefault}
              className="w-40"
            />
          </FormField>
          {invoice?.needsRate && (
            <FormField label={t('rate')} htmlFor="link-rate" error={error?.fieldErrors?.fxRate}>
              <Input id="link-rate" name="fxRate" inputMode="decimal" required className="w-40" />
            </FormField>
          )}
        </div>
      )}
      {kind === 'payout' && <p className="text-sm text-muted-foreground">{t('payoutHint')}</p>}

      {error && !error.fieldErrors && (
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
          <Button
            type="submit"
            disabled={pending || (kind === 'reimbursement' ? split.length === 0 : !picked)}
          >
            {t('link')}
          </Button>
        )}
      </div>
    </form>
  );
}
