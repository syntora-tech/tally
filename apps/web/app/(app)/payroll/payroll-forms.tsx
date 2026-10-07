'use client';

import { parseDecimal, payrollTotalUah, transferFee, type TransferFee } from '@tally/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormat } from '@/lib/format';
import { useLabels } from '@/lib/labels';
import {
  mergeActsAction,
  splitActAction,
  overridePayableAction,
  payItemAction,
  setPayoutRateAction,
  type PayrollFormState,
} from '@/server/actions/payroll';

function useResult(state: PayrollFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
  }, [state, success]);
  return state && !state.ok ? state.error : null;
}

export type PayDialogProps = {
  itemId: string;
  fiat: boolean;
  today: string;
  /** For fiat items without a rate yet: lines and adjustments to preview total_uah (5.2). */
  lines: { amount: string; currency: string }[];
  adjustments: { amount: string; currency: string }[];
  currentRate: string | null;
  currentSource: string | null;
  suggestion: { rate: string; source: string } | null;
  remaining: string | null;
  accounts: { id: string; label: string }[];
  /** Unallocated payout expenses already in the Ledger (statement rows), best matches first. */
  candidates: { id: string; label: string; remaining: string }[];
  isOwner: boolean;
  /** A FOP act follows the payout: a part payment gets an act of its own (A-083). */
  hasAct: boolean;
  /** Acts of activities still to pay (A-085): paying one takes its amount, no split. */
  payableActs: { id: string; label: string; amount: string }[];
  /** The payee's bank tariff; its fee is suggested for a new payment (A-082). */
  fee: TransferFee | null;
  /** Every account, for a fee charged in another currency (e.g. UAH for a USD SWIFT). */
  feeAccounts: { id: string; label: string; currency: string }[];
};

/**
 * "Виплатити" (6.6): rate with its source badge, UAH total, then either a new expense from an
 * account or an existing Ledger expense; either way it is allocated to the item.
 */
export function PayDialog(p: PayDialogProps) {
  const t = useTranslations('payDialog');
  const tc = useTranslations('common');
  const fmt = useFormat();
  const { FX_SOURCE_LABELS } = useLabels();
  // The dialog disappears once the item is paid, so the toast fires before the page re-renders.
  const [state, action, pending] = useActionState<PayrollFormState, FormData>(
    async (prev, formData) => {
      const result = await payItemAction(prev, formData);
      if (result?.ok) toast.success(t('paid'));
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const initialRate = p.currentRate ?? p.suggestion?.rate ?? '';
  const [rate, setRate] = useState(initialRate);
  const [source, setSource] = useState(
    p.currentRate ? (p.currentSource ?? 'manual') : (p.suggestion?.source ?? 'manual'),
  );
  const parsed = parseDecimal(rate.replace(',', '.'));
  const totalUah =
    p.fiat && parsed.isOk() && parsed.value.gt(0)
      ? payrollTotalUah(p.lines, p.adjustments, parsed.value)
      : null;
  const preview = totalUah?.isOk() ? totalUah.value.toFixed(2) : null;
  const [paidFrom, setPaidFrom] = useState<'new' | 'existing'>('new');
  const [transactionId, setTransactionId] = useState('');
  const picked = p.candidates.find((c) => c.id === transactionId);
  const itemAmount = p.remaining ?? preview ?? '';
  const itemLeft = parseDecimal(itemAmount);
  // Linking a statement row: never suggest more than is left on either side.
  const amountDefault =
    paidFrom === 'existing' && picked && !(itemLeft.isOk() && itemLeft.value.lt(picked.remaining))
      ? picked.remaining
      : itemAmount;
  const [open, setOpen] = useState(false);
  const [actId, setActId] = useState('');
  const pickedAct = p.payableActs.find((a) => a.id === actId);
  const [amountInput, setAmountInput] = useState<string | null>(null);
  const payCurrency = p.fiat ? 'UAH' : 'USD';
  const amountNow = parseDecimal(
    (amountInput ?? pickedAct?.amount ?? amountDefault).replace(',', '.'),
  );
  const usdUah = parseDecimal(p.currentRate ?? p.suggestion?.rate ?? '');
  const suggestedFee =
    p.fee && amountNow.isOk()
      ? transferFee(p.fee, amountNow.value, payCurrency, (a, from, to) =>
          from === 'USD' && to === 'UAH' && usdUah.isOk()
            ? a.times(usdUah.value)
            : from === 'UAH' && to === 'USD' && usdUah.isOk() && usdUah.value.gt(0)
              ? a.div(usdUah.value)
              : null,
        )
      : null;
  const feeCurrency = suggestedFee?.currency ?? payCurrency;

  if (!open) {
    return (
      <Button
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('pay')}
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="itemId" value={p.itemId} />
      {p.fiat && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField
            label={t('rate')}
            htmlFor={`rate-${p.itemId}`}
            error={error?.fieldErrors?.rate}
          >
            <Input
              id={`rate-${p.itemId}`}
              name="rate"
              inputMode="decimal"
              value={rate}
              className="w-32"
              onChange={(e) => {
                setRate(e.target.value);
                setSource('manual');
              }}
            />
          </FormField>
          <input type="hidden" name="rateSource" value={source} />
          <Badge variant="outline" className="mb-2">
            {FX_SOURCE_LABELS[source] ?? source}
          </Badge>
          {preview && (
            <span className="mb-2 text-sm">
              {t('toPay')} <span className="font-medium">{fmt.amount(preview, 'UAH')}</span>
            </span>
          )}
        </div>
      )}
      <FormField label={t('source')} htmlFor={`source-${p.itemId}`}>
        <NativeSelect
          id={`source-${p.itemId}`}
          value={paidFrom}
          onChange={(e) => {
            setPaidFrom(e.target.value === 'existing' ? 'existing' : 'new');
          }}
          options={[
            { value: 'new', label: t('sourceNew') },
            { value: 'existing', label: t('sourceExisting') },
          ]}
        />
      </FormField>
      <div className="flex flex-wrap items-end gap-3">
        {paidFrom === 'existing' ? (
          <FormField
            label={t('transaction')}
            htmlFor={`tx-${p.itemId}`}
            error={error?.fieldErrors?.transactionId}
          >
            {p.candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noCandidates')}</p>
            ) : (
              <NativeSelect
                id={`tx-${p.itemId}`}
                name="transactionId"
                placeholder={t('chooseTransaction')}
                value={transactionId}
                onChange={(e) => {
                  setTransactionId(e.target.value);
                }}
                options={p.candidates.map((c) => ({ value: c.id, label: c.label }))}
              />
            )}
          </FormField>
        ) : (
          <>
            <FormField
              label={t('account')}
              htmlFor={`acc-${p.itemId}`}
              error={error?.fieldErrors?.accountId}
            >
              <NativeSelect
                id={`acc-${p.itemId}`}
                name="accountId"
                placeholder={t('chooseAccount')}
                options={p.accounts.map((a) => ({ value: a.id, label: a.label }))}
              />
            </FormField>
            <FormField
              label={t('date')}
              htmlFor={`date-${p.itemId}`}
              error={error?.fieldErrors?.occurredOn}
            >
              <Input id={`date-${p.itemId}`} name="occurredOn" type="date" defaultValue={p.today} />
            </FormField>
          </>
        )}
        <FormField
          label={t('amount', { currency: p.fiat ? 'UAH' : 'USD' })}
          htmlFor={`amount-${p.itemId}`}
          error={error?.fieldErrors?.amount}
        >
          <Input
            id={`amount-${p.itemId}`}
            name="amount"
            inputMode="decimal"
            key={pickedAct?.amount ?? amountDefault}
            defaultValue={pickedAct?.amount ?? amountDefault}
            className="w-36"
            onChange={(e) => {
              setAmountInput(e.target.value);
            }}
          />
        </FormField>
        {paidFrom === 'new' && (
          <>
            <FormField
              label={t('fee', { currency: feeCurrency })}
              htmlFor={`fee-${p.itemId}`}
              error={error?.fieldErrors?.feeAmount}
            >
              <Input
                id={`fee-${p.itemId}`}
                name="feeAmount"
                inputMode="decimal"
                key={suggestedFee?.amount.toFixed(2) ?? 'none'}
                defaultValue={suggestedFee?.amount.toFixed(2) ?? ''}
                className="w-28"
              />
            </FormField>
            <FormField label={t('feeAccount')} htmlFor={`fee-acc-${p.itemId}`}>
              <NativeSelect
                id={`fee-acc-${p.itemId}`}
                name="feeAccountId"
                key={feeCurrency}
                defaultValue={
                  feeCurrency === payCurrency
                    ? ''
                    : (p.feeAccounts.find((a) => a.currency === feeCurrency)?.id ?? '')
                }
                placeholder={t('feeSameAccount')}
                options={p.feeAccounts.map((a) => ({ value: a.id, label: a.label }))}
              />
            </FormField>
          </>
        )}
        {paidFrom === 'new' && (
          <FormField label={t('category')} htmlFor={`cat-${p.itemId}`}>
            <NativeSelect
              id={`cat-${p.itemId}`}
              name="categoryName"
              defaultValue="Contractors"
              options={[
                { value: 'Contractors', label: 'Contractors' },
                { value: 'Payroll', label: 'Payroll' },
              ]}
            />
          </FormField>
        )}
      </div>
      {p.payableActs.length > 0 && (
        <FormField label={t('payAct')} htmlFor={`pay-act-${p.itemId}`}>
          <NativeSelect
            id={`pay-act-${p.itemId}`}
            name="actId"
            value={actId}
            onChange={(e) => {
              setActId(e.target.value);
              setAmountInput(null);
            }}
            placeholder={t('payActRest')}
            options={p.payableActs.map((a) => ({ value: a.id, label: a.label }))}
          />
        </FormField>
      )}
      {p.fiat && p.hasAct && !pickedAct && (
        <div className="flex flex-wrap items-end gap-3">
          <FormField
            label={t('actFrom')}
            htmlFor={`act-from-${p.itemId}`}
            error={error?.fieldErrors?.actFrom}
          >
            <Input id={`act-from-${p.itemId}`} name="actFrom" type="date" className="w-40" />
          </FormField>
          <FormField
            label={t('actTo')}
            htmlFor={`act-to-${p.itemId}`}
            error={error?.fieldErrors?.actTo}
          >
            <Input id={`act-to-${p.itemId}`} name="actTo" type="date" className="w-40" />
          </FormField>
          <p className="mb-2 max-w-sm text-xs text-muted-foreground">{t('actPeriodHint')}</p>
        </div>
      )}
      {p.isOwner && (
        <FormField
          label={t('advanceReason')}
          htmlFor={`override-${p.itemId}`}
          error={error?.fieldErrors?.overrideReason}
        >
          <Input id={`override-${p.itemId}`} name="overrideReason" />
        </FormField>
      )}
      {error && !error.fieldErrors && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {t('record')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}

export function OverrideForm({ lineId }: { lineId: string }) {
  const [state, action, pending] = useActionState<PayrollFormState, FormData>(
    overridePayableAction,
    null,
  );
  const t = useTranslations('payDialog');
  const error = useResult(state, t('released'));
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="lineId" value={lineId} />
      <Input
        name="reason"
        placeholder={t('reason')}
        aria-label={t('releaseReason')}
        className="h-8 w-48"
        required
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t('release')}
      </Button>
      {error && <span className="text-sm text-destructive">{error.message}</span>}
    </form>
  );
}

/**
 * The payout rate set at period close from the NBU (A-076): approve it as is or correct it; the
 * draft FOP act follows. Hidden once the act is issued or money is paid.
 */
export function RateForm({
  itemId,
  rate,
  source,
}: {
  itemId: string;
  rate: string | null;
  source: string | null;
}) {
  const [state, action, pending] = useActionState<PayrollFormState, FormData>(
    setPayoutRateAction,
    null,
  );
  const t = useTranslations('payDialog');
  const error = useResult(state, t('rateApproved'));
  const [value, setValue] = useState(rate ?? '');
  const unchanged =
    rate !== null &&
    parseDecimal(value.replace(',', '.')).isOk() &&
    parseDecimal(value.replace(',', '.'))._unsafeUnwrap().eq(rate);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="source" value={unchanged ? (source ?? 'manual') : 'manual'} />
      <Input
        name="rate"
        inputMode="decimal"
        aria-label={t('rateLabel')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        className="h-8 w-28"
        required
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t('approveRate')}
      </Button>
      {error && <span className="text-sm text-destructive">{error.message}</span>}
    </form>
  );
}

/** Merges two neighbouring draft acts of a payout into one act and one period (A-083). */
export function MergeActsButton({ firstId, secondId }: { firstId: string; secondId: string }) {
  const [state, action, pending] = useActionState<PayrollFormState, FormData>(
    mergeActsAction,
    null,
  );
  const t = useTranslations('payDialog');
  const error = useResult(state, t('merged'));
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="firstId" value={firstId} />
      <input type="hidden" name="secondId" value={secondId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {t('merge')}
      </Button>
      {error && <span className="text-sm text-destructive">{error.message}</span>}
    </form>
  );
}

/**
 * Splits a draft act by activity (A-085): tick the lines and adjustments for a new act and its
 * period at the start or the end of this one; the amounts follow from the activities.
 */
export function SplitActForm({
  actId,
  periodFrom,
  periodTo,
  activities,
}: {
  actId: string;
  periodFrom: string;
  periodTo: string;
  activities: { id: string; kind: 'line' | 'adjustment'; label: string }[];
}) {
  const [state, action, pending] = useActionState<PayrollFormState, FormData>(splitActAction, null);
  const t = useTranslations('payDialog');
  const tc = useTranslations('common');
  const error = useResult(state, t('split'));
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('splitByActivity')}
      </Button>
    );
  }
  return (
    <form action={action} className="flex w-full flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="actId" value={actId} />
      <p className="text-xs text-muted-foreground">{t('splitHint')}</p>
      <fieldset className="flex flex-col gap-1">
        {activities.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name={a.kind === 'line' ? 'lineIds' : 'adjustmentIds'}
              value={a.id}
            />
            {a.label}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label={t('actFrom')}
          htmlFor={`split-from-${actId}`}
          error={error?.fieldErrors?.periodFrom}
        >
          <Input
            id={`split-from-${actId}`}
            name="periodFrom"
            type="date"
            defaultValue={periodFrom}
            min={periodFrom}
            max={periodTo}
            className="w-40"
          />
        </FormField>
        <FormField
          label={t('actTo')}
          htmlFor={`split-to-${actId}`}
          error={error?.fieldErrors?.periodTo}
        >
          <Input
            id={`split-to-${actId}`}
            name="periodTo"
            type="date"
            min={periodFrom}
            max={periodTo}
            className="w-40"
          />
        </FormField>
      </div>
      {error && !error.fieldErrors && <p className="text-sm text-destructive">{error.message}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('splitSubmit')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}
