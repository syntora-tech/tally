'use client';

import { useTranslations } from 'next-intl';
import { parseDecimal, payrollTotalUah } from '@tally/domain';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormat } from '@/lib/format';
import { toOptions, useLabels } from '@/lib/labels';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  addAdjustmentAction,
  closePeriodAction,
  deletePeriodAction,
  draftEarlyActAction,
  draftEarlyInvoiceAction,
  removeAdjustmentAction,
  reopenPeriodAction,
  saveHoursAction,
  updatePeriodAction,
  uploadHoursCsvAction,
  type PeriodFormState,
} from '@/server/actions/periods';

function useResult(state: PeriodFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
  }, [state, success]);
  return state && !state.ok ? state.error : null;
}

function ErrorAlert({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function ParamsForm(props: {
  periodId: string;
  workHours: string;
  referenceFx: string | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    updatePeriodAction,
    null,
  );
  const t = useTranslations('periodForms');
  const tc = useTranslations('common');
  const error = useResult(state, t('paramsSaved'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="periodId" value={props.periodId} />
      <FormField label={t('norm')} htmlFor="workHours" error={error?.fieldErrors?.workHours}>
        <Input
          id="workHours"
          name="workHours"
          defaultValue={props.workHours}
          disabled={props.disabled}
          className="w-32"
        />
      </FormField>
      <FormField label={t('fx')} htmlFor="referenceFxUsdUah">
        <Input
          id="referenceFxUsdUah"
          name="referenceFxUsdUah"
          defaultValue={props.referenceFx ?? ''}
          disabled={props.disabled}
          className="w-40"
        />
      </FormField>
      {!props.disabled && (
        <Button type="submit" variant="outline" disabled={pending}>
          {tc('save')}
        </Button>
      )}
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export type HoursRow = {
  assignmentId: string;
  personName: string;
  clientName: string | null;
  roleTitle: string | null;
  billing: string;
  hours: string | null;
  /** Null when the person is paid for the client hours (A-074). */
  payHours: string | null;
  note: string | null;
};

export function HoursForm({
  periodId,
  rows,
  disabled,
}: {
  periodId: string;
  rows: HoursRow[];
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(saveHoursAction, null);
  const t = useTranslations('periodForms');
  const tc = useTranslations('common');
  const error = useResult(state, t('hoursSaved'));
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="periodId" value={periodId} />
      <ErrorAlert message={error?.message} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.person')}</TableHead>
            <TableHead>{t('col.client')}</TableHead>
            <TableHead>{t('col.role')}</TableHead>
            <TableHead>{t('col.terms')}</TableHead>
            <TableHead className="w-32">{t('col.hours')}</TableHead>
            <TableHead className="w-32">{t('col.payHours')}</TableHead>
            <TableHead>{t('col.note')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.assignmentId}>
              <TableCell>{r.personName}</TableCell>
              <TableCell>{r.clientName ?? tc('internal')}</TableCell>
              <TableCell className="text-muted-foreground">{r.roleTitle ?? '—'}</TableCell>
              <TableCell className="text-muted-foreground">{r.billing}</TableCell>
              <TableCell>
                <Input
                  name={`hours.${r.assignmentId}`}
                  aria-label={t('hoursAria', {
                    person: r.personName,
                    client: r.clientName ?? tc('internal'),
                  })}
                  inputMode="decimal"
                  defaultValue={r.hours ?? ''}
                  disabled={disabled}
                  className="h-8 w-24"
                />
              </TableCell>
              <TableCell>
                <Input
                  name={`payHours.${r.assignmentId}`}
                  aria-label={t('payHoursAria', {
                    person: r.personName,
                    client: r.clientName ?? tc('internal'),
                  })}
                  inputMode="decimal"
                  placeholder={t('payHoursPlaceholder')}
                  defaultValue={r.payHours ?? ''}
                  disabled={disabled}
                  className="h-8 w-24"
                />
              </TableCell>
              <TableCell>
                <Input
                  name={`note.${r.assignmentId}`}
                  aria-label={t('noteAria', {
                    person: r.personName,
                    client: r.clientName ?? tc('internal'),
                  })}
                  placeholder={t('notePlaceholder')}
                  maxLength={200}
                  defaultValue={r.note ?? ''}
                  disabled={disabled}
                  className="h-8 w-56"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!disabled && (
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? tc('saving') : t('saveHours')}
        </Button>
      )}
    </form>
  );
}

export function HoursCsvForm({ periodId }: { periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    uploadHoursCsvAction,
    null,
  );
  const t = useTranslations('periodForms');
  const error = useResult(state, t('csvImported'));
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="periodId" value={periodId} />
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        aria-label={t('csvFile')}
        className="text-sm"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t('importCsv')}
      </Button>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

export function CloseForm({ periodId }: { periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    closePeriodAction,
    null,
  );
  const t = useTranslations('periodForms');
  const error = useResult(state, t('closed'));
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t('confirmClose'))) e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="periodId" value={periodId} />
      <ErrorAlert message={error?.message} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? t('closing') : t('close')}
      </Button>
    </form>
  );
}

/** Deletes an open period opened by mistake; the service refuses one with anything in it. */
export function DeletePeriodForm({ periodId }: { periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    deletePeriodAction,
    null,
  );
  const t = useTranslations('periodForms');
  const error = state && !state.ok ? state.error : null;
  return (
    <form
      action={action}
      className="flex flex-col items-end gap-2"
      onSubmit={(e) => {
        if (!confirm(t('deleteConfirm'))) e.preventDefault();
      }}
    >
      <input type="hidden" name="periodId" value={periodId} />
      <Button type="submit" variant="ghost" className="text-destructive" disabled={pending}>
        {t('delete')}
      </Button>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

export function ReopenForm({ periodId }: { periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    reopenPeriodAction,
    null,
  );
  const t = useTranslations('periodForms');
  const error = useResult(state, t('reopened'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="periodId" value={periodId} />
      <FormField label={t('reopenReason')} htmlFor="reason" error={error?.fieldErrors?.reason}>
        <Input id="reason" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {t('reopen')}
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function AdjustmentForm(props: {
  periodId: string;
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    addAdjustmentAction,
    null,
  );
  const t = useTranslations('periodForms');
  const tc = useTranslations('common');
  const { ADJUSTMENT_KIND_LABELS } = useLabels();
  const error = useResult(state, t('adjustmentAdded'));
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-3 md:grid-cols-7">
      <input type="hidden" name="periodId" value={props.periodId} />
      <FormField label={t('person')} htmlFor="adj-person" error={error?.fieldErrors?.personId}>
        <NativeSelect
          id="adj-person"
          name="personId"
          placeholder={t('choose')}
          options={props.people.map((p) => ({ value: p.id, label: p.name }))}
        />
      </FormField>
      <FormField label={t('kind')} htmlFor="adj-kind">
        <NativeSelect
          id="adj-kind"
          name="kind"
          defaultValue="bonus"
          options={toOptions(ADJUSTMENT_KIND_LABELS)}
        />
      </FormField>
      <FormField label={t('amount')} htmlFor="adj-amount" error={error?.fieldErrors?.amount}>
        <Input id="adj-amount" name="amount" inputMode="decimal" />
      </FormField>
      <FormField label={t('currency')} htmlFor="adj-currency" error={error?.fieldErrors?.currency}>
        <NativeSelect
          id="adj-currency"
          name="currency"
          defaultValue="UAH"
          options={[
            { value: 'UAH', label: 'UAH' },
            { value: 'USD', label: 'USD' },
          ]}
        />
      </FormField>
      <FormField label={t('payout')} htmlFor="adj-method">
        <NativeSelect
          id="adj-method"
          name="payoutMethod"
          defaultValue="fiat"
          options={[
            { value: 'fiat', label: 'fiat' },
            { value: 'crypto', label: 'crypto' },
          ]}
        />
      </FormField>
      <FormField label={t('reason')} htmlFor="adj-reason" error={error?.fieldErrors?.reason}>
        <Input id="adj-reason" name="reason" required />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {tc('add')}
      </Button>
      <div className="col-span-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function RemoveAdjustmentButton({ id, periodId }: { id: string; periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    removeAdjustmentAction,
    null,
  );
  const t = useTranslations('periodForms');
  const tc = useTranslations('common');
  useResult(state, t('adjustmentRemoved'));
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="periodId" value={periodId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {tc('delete')}
      </Button>
    </form>
  );
}

/** "Create invoice" / "Recalculate" for one contract or SOW before the close (A-076). */
export function EarlyInvoiceButton({
  periodId,
  contractId,
  annexId,
  label,
}: {
  periodId: string;
  contractId: string;
  annexId: string | null;
  label: string;
}) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    draftEarlyInvoiceAction,
    null,
  );
  const t = useTranslations('periodForms');
  const error = useResult(state, t('earlyInvoiceDone'));
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="contractId" value={contractId} />
      <input type="hidden" name="annexId" value={annexId ?? ''} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {label}
      </Button>
      {error && <span className="text-sm text-destructive">{error.message}</span>}
    </form>
  );
}

/**
 * Monthly FOP act before the close (A-076): the USD part is converted at the rate approved here
 * (NBU of today by default); the UAH part is taken as it is.
 */
export function EarlyActForm({
  periodId,
  personId,
  usd,
  uah,
  needsRate,
  defaultRate,
  label,
}: {
  periodId: string;
  personId: string;
  usd: string;
  uah: string;
  needsRate: boolean;
  defaultRate: string | null;
  label: string;
}) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    draftEarlyActAction,
    null,
  );
  const t = useTranslations('periodForms');
  const fmt = useFormat();
  const error = useResult(state, t('earlyActDone'));
  const [rate, setRate] = useState(defaultRate ?? '');
  const parsed = parseDecimal(rate.replace(',', '.'));
  const total = payrollTotalUah(
    [
      { amount: usd, currency: 'USD' },
      { amount: uah, currency: 'UAH' },
    ],
    [],
    parsed.isOk() && parsed.value.gt(0) ? parsed.value : null,
  );
  const unchanged = defaultRate !== null && parsed.isOk() && parsed.value.eq(defaultRate);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="periodId" value={periodId} />
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="rateSource" value={unchanged ? 'nbu' : 'manual'} />
      {needsRate && (
        <Input
          name="rate"
          inputMode="decimal"
          aria-label={t('earlyActRate')}
          value={rate}
          onChange={(e) => {
            setRate(e.target.value);
          }}
          className="h-8 w-28"
          required
        />
      )}
      <span className="text-sm tabular-nums">
        {total.isOk() ? fmt.amount(total.value.toFixed(2), 'UAH') : '—'}
      </span>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {label}
      </Button>
      {error && <span className="text-sm text-destructive">{error.message}</span>}
    </form>
  );
}
