'use client';

import {
  addDays,
  diffDays,
  parseDecimal,
  payrollTotalUah,
  transferFee,
  type LocalDate,
  type TransferFee,
} from '@tally/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDialogScope } from '@/components/v2/form-dialog';
import { useFormat } from '@/lib/format';
import { useLabels } from '@/lib/labels';
import {
  changePayoutMethodAction,
  removePayoutLineAction,
  adjustClosedPayoutAction,
  mergeActsAction,
  splitActAction,
  overridePayableAction,
  payItemAction,
  setPayoutRateAction,
  type PayrollFormState,
} from '@/server/actions/payroll';

/**
 * In a v2 dialog the toast fires from the action itself: a successful action can move its row to
 * another tab, and an effect of the unmounted form would never run. v1 keeps the effect.
 */
function useToastAction(
  run: (prev: PayrollFormState, formData: FormData) => Promise<PayrollFormState>,
  success: string,
) {
  const dialog = useDialogScope();
  const result = useActionState<PayrollFormState, FormData>(async (prev, formData) => {
    const next = await run(prev, formData);
    if (next?.ok && dialog) {
      toast.success(success);
      dialog.close();
    }
    return next;
  }, null);
  const [state] = result;
  useEffect(() => {
    if (state?.ok && !dialog) toast.success(success);
  }, [state, success, dialog]);
  return result;
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
  /**
   * The document the payment needs signed first (A-096): FOP acts (the signed ones, the act of the
   * rest) or a contractor invoice; null when the payout has no document.
   */
  document:
    | { kind: 'act'; signedActIds: string[]; restSigned: boolean }
    | { kind: 'invoice'; signed: boolean }
    | null;
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
  const dialog = useDialogScope();
  useEffect(() => {
    if (state?.ok) dialog?.close();
  }, [state, dialog]);
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
  // The statement is the source of truth: a payout already in the Ledger carries the bank's real fee.
  const [paidFrom, setPaidFrom] = useState<'new' | 'existing'>(
    p.candidates.length > 0 ? 'existing' : 'new',
  );
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
  const remainingNow = parseDecimal(p.remaining ?? '');
  // Paying part of the act of the rest would cut a new, unsigned act off it.
  const unsigned =
    p.document?.kind === 'invoice'
      ? !p.document.signed
      : p.document?.kind === 'act'
        ? actId
          ? !p.document.signedActIds.includes(actId)
          : !p.document.restSigned ||
            (amountNow.isOk() && remainingNow.isOk() && amountNow.value.lt(remainingNow.value))
        : false;

  if (!open && !dialog) {
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
    <form
      action={action}
      className={dialog ? 'flex flex-col gap-3' : 'flex flex-col gap-3 rounded-md border p-3'}
    >
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
                aria-describedby={`tx-fee-${p.itemId}`}
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
            <p id={`tx-fee-${p.itemId}`} className="text-xs text-muted-foreground">
              {t('feeFromStatement')}
            </p>
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
      {unsigned && (
        <Alert role="status">
          <AlertDescription>
            {p.document?.kind === 'invoice' ? t('invoiceNotSigned') : t('actNotSigned')}
          </AlertDescription>
        </Alert>
      )}
      {unsigned && p.isOwner && (
        <FormField
          label={t('documentOverrideReason')}
          htmlFor={`doc-override-${p.itemId}`}
          error={error?.fieldErrors?.documentOverrideReason}
        >
          <Input id={`doc-override-${p.itemId}`} name="documentOverrideReason" required />
        </FormField>
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
        <Button type="submit" disabled={pending || (unsigned && !p.isOwner)}>
          {t('record')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (dialog) dialog.close();
            else setOpen(false);
          }}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}

export function OverrideForm({ lineId }: { lineId: string }) {
  const t = useTranslations('payDialog');
  const [state, action, pending] = useToastAction(overridePayableAction, t('released'));
  const error = state && !state.ok ? state.error : null;
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

/** Owner only (A-097): a line that does not belong to the payout, e.g. a salary paid by plan. */
export function RemoveLineForm({ lineId }: { lineId: string }) {
  const t = useTranslations('payroll');
  const [state, action, pending] = useToastAction(removePayoutLineAction, t('lineRemoved'));
  const error = state && !state.ok ? state.error : null;
  const dialog = useDialogScope();
  const form = (
    <form
      action={action}
      className={
        dialog ? 'flex flex-wrap items-center gap-2' : 'mt-1 flex flex-wrap items-center gap-2'
      }
    >
      <input type="hidden" name="lineId" value={lineId} />
      <Input
        name="reason"
        placeholder={t('removeLineReason')}
        aria-label={t('removeLineReason')}
        className="h-8 w-56"
        required
      />
      <Button type="submit" size="sm" variant="destructive" disabled={pending}>
        {t('removeLine')}
      </Button>
      {error && <span className="text-destructive">{error.message}</span>}
    </form>
  );
  if (dialog) return form;
  return (
    <details className="text-xs" data-testid="remove-line">
      <summary className="cursor-pointer text-muted-foreground">{t('removeLine')}</summary>
      {form}
    </details>
  );
}

/** Owner only: an adjustment of an unpaid payout of a closed month (A-099). */
export function AdjustClosedForm({
  itemId,
  fiat,
  acts,
}: {
  itemId: string;
  fiat: boolean;
  /** Draft acts of the payout, the act of the rest first: where the adjustment goes (A-100). */
  acts: { id: string; label: string }[];
}) {
  const t = useTranslations('payroll');
  const [state, action, pending] = useToastAction(adjustClosedPayoutAction, t('adjusted'));
  const error = state && !state.ok ? state.error : null;
  const dialog = useDialogScope();
  const currencies = fiat ? ['USD', 'UAH'] : ['USD', 'USDT', 'USDC'];
  const form = (
    <form
      action={action}
      className={
        dialog ? 'flex flex-wrap items-center gap-2' : 'mt-2 flex flex-wrap items-center gap-2'
      }
    >
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="kind" value="correction" />
      <Input
        name="amount"
        inputMode="decimal"
        placeholder={t('adjustAmount')}
        aria-label={t('adjustAmount')}
        className="h-8 w-40"
        required
      />
      <NativeSelect
        name="currency"
        aria-label="Currency"
        className="h-8 w-24"
        options={currencies.map((c) => ({ value: c, label: c }))}
      />
      {acts.length > 1 && (
        <NativeSelect
          name="actId"
          aria-label={t('adjustAct')}
          className="h-8 w-72"
          options={acts.map((a) => ({ value: a.id, label: `${t('adjustAct')}: ${a.label}` }))}
        />
      )}
      <Input
        name="reason"
        placeholder={t('adjustReason')}
        aria-label={t('adjustReason')}
        className="h-8 w-64"
        required
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t('adjustSubmit')}
      </Button>
      {error && <span className="text-sm text-destructive">{error.message}</span>}
    </form>
  );
  if (dialog) return form;
  return (
    <details className="text-sm" data-testid="adjust-closed">
      <summary className="cursor-pointer text-muted-foreground">{t('adjustClosed')}</summary>
      {form}
    </details>
  );
}

/** Owner only: an unpaid payout closed under the wrong method moves to a USD one (A-092). */
export function ChangeMethodForm({ itemId, current }: { itemId: string; current: string }) {
  const t = useTranslations('payroll');
  const { PAYOUT_METHOD_LABELS } = useLabels();
  const [state, action, pending] = useToastAction(changePayoutMethodAction, t('methodChanged'));
  const error = state && !state.ok ? state.error : null;
  const dialog = useDialogScope();
  const methods = (['bank_usd', 'crypto'] as const).filter((m) => m !== current);
  const form = (
    <form
      action={action}
      className={
        dialog ? 'flex flex-wrap items-center gap-2' : 'mt-2 flex flex-wrap items-center gap-2'
      }
    >
      <input type="hidden" name="itemId" value={itemId} />
      <NativeSelect
        name="payoutMethod"
        aria-label={t('changeMethodLabel')}
        className="h-8 w-40"
        options={methods.map((m) => ({ value: m, label: PAYOUT_METHOD_LABELS[m] ?? m }))}
      />
      <Input
        name="reason"
        placeholder={t('changeMethodReason')}
        aria-label={t('changeMethodReason')}
        className="h-8 w-56"
        required
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t('changeMethod')}
      </Button>
      {error && <span className="text-sm text-destructive">{error.message}</span>}
    </form>
  );
  if (dialog) return form;
  return (
    <details className="text-sm" data-testid="change-payout-method">
      <summary className="cursor-pointer text-muted-foreground">{t('changeMethod')}</summary>
      {form}
    </details>
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
  const t = useTranslations('payDialog');
  const [state, action, pending] = useToastAction(setPayoutRateAction, t('rateApproved'));
  const error = state && !state.ok ? state.error : null;
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
  const t = useTranslations('payDialog');
  const [state, action, pending] = useToastAction(mergeActsAction, t('merged'));
  const error = state && !state.ok ? state.error : null;
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
 * Splits a draft act in two at a chosen day (A-085, A-086): what goes into the new act is either
 * ticked activities or a USD share; the new act takes the days before or after the boundary.
 */
export function SplitActForm({
  actId,
  periodFrom,
  periodTo,
  activities,
  byAmount,
  extendable = false,
}: {
  actId: string;
  periodFrom: string;
  periodTo: string;
  activities: { id: string; kind: 'line' | 'assignment' | 'adjustment'; label: string }[];
  byAmount: boolean;
  /** The last act of a closed payout: the later act may run on into the next months (A-098). */
  extendable?: boolean;
}) {
  const t = useTranslations('payDialog');
  const tc = useTranslations('common');
  const fmt = useFormat();
  const [state, action, pending] = useToastAction(splitActAction, t('split'));
  const error = state && !state.ok ? state.error : null;
  // Open since a given result; a later successful split closes the form.
  const [openedAt, setOpenedAt] = useState<{ state: PayrollFormState } | null>(null);
  const open = openedAt !== null && !(state !== openedAt.state && state?.ok);
  const [end, setEnd] = useState(periodTo);
  const [boundary, setBoundary] = useState<string>(() =>
    periodFrom < periodTo ? midDay(periodFrom, periodTo) : '',
  );
  const byActivity = activities.length > 1;
  const dialog = useDialogScope();
  if (!open && !dialog) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          setOpenedAt({ state });
        }}
      >
        {t('splitAct')}
      </Button>
    );
  }
  const after = boundary ? nextDay(boundary) : '';
  return (
    <form
      action={action}
      className={
        dialog ? 'flex flex-col gap-3' : 'flex w-full flex-col gap-3 rounded-md border p-3'
      }
    >
      <input type="hidden" name="actId" value={actId} />
      <input type="hidden" name="actFrom" value={periodFrom} />
      <input type="hidden" name="actTo" value={periodTo} />
      {!extendable && <input type="hidden" name="actEnd" value={periodTo} />}
      <p className="text-xs text-muted-foreground">
        {t('splitHint')}
        {extendable && ` ${t('splitEndHint')}`}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label={t('splitBoundary')}
          htmlFor={`split-boundary-${actId}`}
          error={error?.fieldErrors?.periodTo ?? error?.fieldErrors?.periodFrom}
        >
          <Input
            id={`split-boundary-${actId}`}
            name="boundary"
            type="date"
            value={boundary}
            min={periodFrom}
            max={end ? prevDay(end) : undefined}
            onChange={(e) => {
              setBoundary(e.target.value);
            }}
            className="w-40"
          />
        </FormField>
        {extendable && (
          <FormField
            label={t('splitEnd')}
            htmlFor={`split-end-${actId}`}
            error={error?.fieldErrors?.periodEnd}
          >
            <Input
              id={`split-end-${actId}`}
              name="actEnd"
              type="date"
              value={end}
              min={periodTo}
              onChange={(e) => {
                setEnd(e.target.value);
              }}
              className="w-40"
            />
          </FormField>
        )}
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 text-xs text-muted-foreground">{t('splitSide')}</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="side" value="first" defaultChecked />
            {boundary ? `${fmt.date(periodFrom)}–${fmt.date(boundary)}` : t('splitFirst')}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="side" value="second" />
            {after && end ? `${fmt.date(after)}–${fmt.date(end)}` : t('splitSecond')}
          </label>
        </fieldset>
      </div>
      {byActivity && (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs text-muted-foreground">{t('splitActivities')}</legend>
          {activities.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`${a.kind}Ids`} value={a.id} />
              {a.label}
            </label>
          ))}
        </fieldset>
      )}
      {byAmount && (
        <FormField
          label={byActivity ? t('splitOrAmount') : t('splitAmount')}
          htmlFor={`split-amount-${actId}`}
          error={error?.fieldErrors?.amountUsd}
        >
          <Input
            id={`split-amount-${actId}`}
            name="amountUsd"
            inputMode="decimal"
            placeholder="1000"
            className="w-40"
          />
        </FormField>
      )}
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
            if (dialog) dialog.close();
            else setOpenedAt(null);
          }}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}

const nextDay = (day: string) => addDays(day as LocalDate, 1);
const prevDay = (day: string) => addDays(day as LocalDate, -1);

/** The middle of a period, e.g. the 15th of a whole month. */
const midDay = (from: string, to: string) =>
  addDays(from as LocalDate, Math.floor(diffDays(from as LocalDate, to as LocalDate) / 2));
