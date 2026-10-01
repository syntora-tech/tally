'use client';

import { parseDecimal, payrollTotalUah } from '@tally/domain';
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
  overridePayableAction,
  payItemAction,
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
  linesUsd: string[];
  adjustments: { amount: string; currency: string }[];
  currentRate: string | null;
  currentSource: string | null;
  suggestion: { rate: string; source: string } | null;
  remaining: string | null;
  accounts: { id: string; label: string }[];
  isOwner: boolean;
};

/** "Виплатити" (6.6): rate with its source badge, UAH total, account; creates expense + allocation. */
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
      ? payrollTotalUah(p.linesUsd, p.adjustments, parsed.value)
      : null;
  const preview = totalUah?.isOk() ? totalUah.value.toFixed(2) : null;
  const amountDefault = p.remaining ?? preview ?? '';
  const [open, setOpen] = useState(false);

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
      <div className="flex flex-wrap items-end gap-3">
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
        <FormField label={t('date')} htmlFor={`date-${p.itemId}`}>
          <Input id={`date-${p.itemId}`} name="occurredOn" type="date" defaultValue={p.today} />
        </FormField>
        <FormField
          label={t('amount', { currency: p.fiat ? 'UAH' : 'USD' })}
          htmlFor={`amount-${p.itemId}`}
          error={error?.fieldErrors?.amount}
        >
          <Input
            id={`amount-${p.itemId}`}
            name="amount"
            inputMode="decimal"
            key={amountDefault}
            defaultValue={amountDefault}
            className="w-36"
          />
        </FormField>
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
      </div>
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
