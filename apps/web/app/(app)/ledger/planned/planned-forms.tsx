'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { usePlannedFeedback } from '@/components/payment-charge-forms';
import { TransferFeeFields, type TransferFeeValues } from '@/components/transfer-fee-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { editableDecimal } from '@/lib/format';
import {
  deletePlannedExpenseAction,
  deletePlannedPartAction,
  payPlannedAction,
  resetPlannedAmountAction,
  savePlannedExpenseAction,
  savePlannedPartAction,
  setPlannedAmountAction,
  skipPlannedAction,
  unlinkPlannedAction,
  unskipPlannedAction,
  type PlannedFormState,
} from '@/server/actions/planned';

type Option = { value: string; label: string };

export type PlannedValues = TransferFeeValues & {
  id: string;
  name: string;
  categoryId: string;
  amount: string;
  currency: string;
  frequency: 'monthly' | 'quarterly' | 'yearly';
  anchorMonth: number | null;
  dueDay: number | null;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
  personId: string | null;
  counterparty: string | null;
};

export function PlannedExpenseForm({
  value,
  categories,
  people,
  thisMonth,
}: {
  value?: PlannedValues;
  categories: Option[];
  people: Option[];
  thisMonth: string;
}) {
  const [state, action, pending] = useActionState(savePlannedExpenseAction, null);
  const t = useTranslations('planned');
  const tm = useTranslations('months');
  const tc = useTranslations('common');
  const errors = usePlannedFeedback(state, value ? t('saved') : t('added'));
  const [frequency, setFrequency] = useState(value?.frequency ?? 'monthly');
  const p = value ? `pe-${value.id}` : 'pe-new';
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: tm(String(i + 1) as '1'),
  }));
  return (
    <form action={action} className="grid grid-cols-2 items-start gap-3 md:grid-cols-6">
      {value && <input type="hidden" name="id" value={value.id} />}
      <FormField
        label={t('name')}
        htmlFor={`${p}-name`}
        error={errors?.name}
        className="col-span-2"
      >
        <Input id={`${p}-name`} name="name" defaultValue={value?.name} required />
      </FormField>
      <FormField label={t('category')} htmlFor={`${p}-category`} error={errors?.categoryId}>
        <NativeSelect
          id={`${p}-category`}
          name="categoryId"
          defaultValue={value?.categoryId ?? ''}
          placeholder={t('chooseCategory')}
          options={categories}
        />
      </FormField>
      <FormField label={t('amount')} htmlFor={`${p}-amount`} error={errors?.amount}>
        <Input
          id={`${p}-amount`}
          name="amount"
          inputMode="decimal"
          defaultValue={editableDecimal(value?.amount)}
          required
        />
      </FormField>
      <FormField label={t('currency')} htmlFor={`${p}-currency`} error={errors?.currency}>
        <Input id={`${p}-currency`} name="currency" defaultValue={value?.currency ?? 'UAH'} />
      </FormField>
      <FormField label={t('frequency')} htmlFor={`${p}-frequency`}>
        <NativeSelect
          id={`${p}-frequency`}
          name="frequency"
          value={frequency}
          onChange={(e) => {
            setFrequency(e.target.value as PlannedValues['frequency']);
          }}
          options={(['monthly', 'quarterly', 'yearly'] as const).map((f) => ({
            value: f,
            label: t(`frequencies.${f}`),
          }))}
        />
      </FormField>
      {frequency !== 'monthly' && (
        <FormField label={t('anchorMonth')} htmlFor={`${p}-anchor`} error={errors?.anchorMonth}>
          <NativeSelect
            id={`${p}-anchor`}
            name="anchorMonth"
            defaultValue={value?.anchorMonth ? String(value.anchorMonth) : ''}
            placeholder="—"
            options={months}
          />
        </FormField>
      )}
      <FormField label={t('dueDay')} htmlFor={`${p}-day`} error={errors?.dueDay}>
        <Input
          id={`${p}-day`}
          name="dueDay"
          type="number"
          min={1}
          max={31}
          defaultValue={value?.dueDay ?? ''}
        />
      </FormField>
      <FormField label={t('startsOn')} htmlFor={`${p}-from`} error={errors?.startsOn}>
        <Input
          id={`${p}-from`}
          name="startsOn"
          type="month"
          defaultValue={(value?.startsOn ?? thisMonth).slice(0, 7)}
        />
      </FormField>
      <FormField label={t('endsOn')} htmlFor={`${p}-to`} error={errors?.endsOn}>
        <Input
          id={`${p}-to`}
          name="endsOn"
          type="month"
          defaultValue={value?.endsOn?.slice(0, 7) ?? ''}
        />
      </FormField>
      <FormField
        label={t('person')}
        htmlFor={`${p}-person`}
        error={errors?.personId}
        className="col-span-2"
      >
        <NativeSelect
          id={`${p}-person`}
          name="personId"
          defaultValue={value?.personId ?? ''}
          placeholder="—"
          options={people}
        />
      </FormField>
      <FormField label={t('counterparty')} htmlFor={`${p}-counterparty`}>
        <Input
          id={`${p}-counterparty`}
          name="counterparty"
          defaultValue={value?.counterparty ?? ''}
        />
      </FormField>
      <FormField label={t('notes')} htmlFor={`${p}-notes`} className="col-span-2 md:col-span-6">
        <Input id={`${p}-notes`} name="notes" defaultValue={value?.notes ?? ''} />
      </FormField>
      <TransferFeeFields idPrefix={p} value={value} errors={errors} />
      <div className="col-span-full">
        <Button type="submit" variant={value ? 'outline' : 'default'} disabled={pending}>
          {value ? tc('save') : tc('add')}
        </Button>
      </div>
    </form>
  );
}

function IconDelete({
  action,
  id,
  confirmText,
  success,
}: {
  action: (prev: PlannedFormState, formData: FormData) => Promise<PlannedFormState>;
  id: string;
  confirmText: string;
  success: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  const tc = useTranslations('common');
  usePlannedFeedback(state, success);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        disabled={pending}
        aria-label={tc('delete')}
      >
        <Trash2 className="size-4" />
      </Button>
    </form>
  );
}

export function DeletePlannedExpenseButton({ id }: { id: string }) {
  const t = useTranslations('planned');
  return (
    <IconDelete
      action={deletePlannedExpenseAction}
      id={id}
      confirmText={t('confirmDelete')}
      success={t('deleted')}
    />
  );
}

export function DeletePlannedPartButton({ id }: { id: string }) {
  const t = useTranslations('planned');
  return (
    <IconDelete
      action={deletePlannedPartAction}
      id={id}
      confirmText={t('confirmDeletePart')}
      success={t('partDeleted')}
    />
  );
}

export type PartValues = {
  id: string;
  name: string;
  amount: string | null;
  dueDay: number;
  monthOffset: number;
};

/** An instalment: a fixed amount or the rest, due on a day of the month or of the next one. */
export function PlannedPartForm({ expenseId, value }: { expenseId: string; value?: PartValues }) {
  const [state, action, pending] = useActionState(savePlannedPartAction, null);
  const t = useTranslations('planned');
  const tc = useTranslations('common');
  const errors = usePlannedFeedback(state, t('partSaved'));
  const p = `part-${value?.id ?? expenseId}`;
  return (
    <form action={action} className="flex flex-wrap items-start gap-3">
      <input type="hidden" name="plannedExpenseId" value={expenseId} />
      {value && <input type="hidden" name="id" value={value.id} />}
      <FormField label={t('partName')} htmlFor={`${p}-name`} error={errors?.name}>
        <Input id={`${p}-name`} name="name" defaultValue={value?.name} className="w-40" />
      </FormField>
      <FormField label={t('partAmount')} htmlFor={`${p}-amount`} error={errors?.amount}>
        <Input
          id={`${p}-amount`}
          name="amount"
          inputMode="decimal"
          defaultValue={editableDecimal(value?.amount)}
          placeholder={t('rest')}
          className="w-32"
        />
      </FormField>
      <FormField label={t('dueDay')} htmlFor={`${p}-day`} error={errors?.dueDay}>
        <Input
          id={`${p}-day`}
          name="dueDay"
          type="number"
          min={1}
          max={31}
          defaultValue={value?.dueDay ?? ''}
          className="w-20"
        />
      </FormField>
      <FormField label={t('monthOffset')} htmlFor={`${p}-offset`}>
        <NativeSelect
          id={`${p}-offset`}
          name="monthOffset"
          defaultValue={String(value?.monthOffset ?? 0)}
          options={[
            { value: '0', label: t('sameMonth') },
            { value: '1', label: t('nextMonth') },
          ]}
        />
      </FormField>
      <Button type="submit" size="sm" variant={value ? 'outline' : 'default'} disabled={pending}>
        {value ? tc('save') : tc('add')}
      </Button>
    </form>
  );
}

/** One-button forms for a payment: skip back, unlink, reset the amount. */
function PaymentButton({
  action,
  id,
  label,
  success,
}: {
  action: (prev: PlannedFormState, formData: FormData) => Promise<PlannedFormState>;
  id: string;
  label: string;
  success: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  usePlannedFeedback(state, success);
  return (
    <form action={run}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {label}
      </Button>
    </form>
  );
}

export function UnskipButton({ id }: { id: string }) {
  const t = useTranslations('plannedPayments');
  return (
    <PaymentButton
      action={unskipPlannedAction}
      id={id}
      label={t('unskip')}
      success={t('unskipped')}
    />
  );
}

export function UnlinkButton({ id }: { id: string }) {
  const t = useTranslations('plannedPayments');
  return (
    <PaymentButton
      action={unlinkPlannedAction}
      id={id}
      label={t('unlink')}
      success={t('unlinked')}
    />
  );
}

export function ResetAmountButton({ id }: { id: string }) {
  const t = useTranslations('plannedPayments');
  return (
    <PaymentButton
      action={resetPlannedAmountAction}
      id={id}
      label={t('reset')}
      success={t('amountSaved')}
    />
  );
}

type Mode = 'pay' | 'amount' | 'skip' | null;

/**
 * Actions of a payment still to pay (A-082): "Paid" (a new expense with its fee, or one from a
 * statement), this month's amount (gross for a salary instalment) and "Skip" with a reason.
 */
export function PaymentActions({
  id,
  isInstalment,
  amount,
  gross,
  currency,
  fee,
  today,
  accounts,
  candidates,
}: {
  id: string;
  isInstalment: boolean;
  /** What to pay (net of withheld charges). */
  amount: string;
  /** Gross of a salary instalment, edited instead of the amount. */
  gross: string | null;
  currency: string;
  fee: { amount: string; currency: string } | null;
  today: string;
  accounts: { id: string; label: string; currency: string }[];
  candidates: { id: string; label: string }[];
}) {
  const t = useTranslations('plannedPayments');
  const tc = useTranslations('common');
  const [mode, setMode] = useState<Mode>(null);
  const [paidFrom, setPaidFrom] = useState<'new' | 'existing'>(
    candidates.length ? 'existing' : 'new',
  );
  // The actions disappear once the payment is paid, so the toast fires from the action itself.
  const [payState, pay, paying] = useActionState<PlannedFormState, FormData>(
    async (prev, formData) => {
      const result = await payPlannedAction(prev, formData);
      if (result?.ok) toast.success(t('paid'));
      return result;
    },
    null,
  );
  const [amountState, setAmount, saving] = useActionState(setPlannedAmountAction, null);
  const [skipState, skip, skipping] = useActionState(skipPlannedAction, null);
  const payErrors = payState && !payState.ok ? payState.error.fieldErrors : undefined;
  const payError =
    payState && !payState.ok && !payState.error.fieldErrors ? payState.error.message : null;
  const amountErrors = usePlannedFeedback(amountState, t('amountSaved'));
  const skipErrors = usePlannedFeedback(skipState, t('skipped'));
  const p = `pp-${id}`;
  const own = accounts.filter((a) => a.currency === currency);

  if (mode === null) {
    return (
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          onClick={() => {
            setMode('pay');
          }}
        >
          {t('pay')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMode('amount');
          }}
        >
          {isInstalment ? t('setGross') : t('setAmount')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setMode('skip');
          }}
        >
          {t('skip')}
        </Button>
      </div>
    );
  }
  const cancel = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => {
        setMode(null);
      }}
    >
      {tc('cancel')}
    </Button>
  );
  if (mode === 'amount') {
    return (
      <form action={setAmount} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <FormField
          label={isInstalment ? t('gross', { currency }) : t('amount', { currency })}
          htmlFor={`${p}-amount`}
          error={amountErrors?.amount}
        >
          <Input
            id={`${p}-amount`}
            name="amount"
            inputMode="decimal"
            defaultValue={editableDecimal(isInstalment ? (gross ?? amount) : amount)}
            className="w-32"
          />
        </FormField>
        <Button type="submit" size="sm" disabled={saving}>
          {tc('save')}
        </Button>
        {cancel}
      </form>
    );
  }
  if (mode === 'skip') {
    return (
      <form action={skip} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={id} />
        <FormField label={t('skipReason')} htmlFor={`${p}-reason`} error={skipErrors?.reason}>
          <Input id={`${p}-reason`} name="reason" className="w-56" />
        </FormField>
        <Button type="submit" size="sm" disabled={skipping}>
          {t('skip')}
        </Button>
        {cancel}
      </form>
    );
  }
  return (
    <form action={pay} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label={t('source')} htmlFor={`${p}-source`}>
        <NativeSelect
          id={`${p}-source`}
          value={paidFrom}
          onChange={(e) => {
            setPaidFrom(e.target.value === 'existing' ? 'existing' : 'new');
          }}
          options={[
            { value: 'existing', label: t('sourceExisting') },
            { value: 'new', label: t('sourceNew') },
          ]}
        />
      </FormField>
      {paidFrom === 'existing' ? (
        <FormField label={t('transaction')} htmlFor={`${p}-tx`} error={payErrors?.transactionIds}>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noCandidates')}</p>
          ) : (
            <NativeSelect
              id={`${p}-tx`}
              name="transactionId"
              placeholder={t('chooseTransaction')}
              options={candidates.map((c) => ({ value: c.id, label: c.label }))}
            />
          )}
        </FormField>
      ) : (
        <>
          <FormField label={t('account')} htmlFor={`${p}-acc`} error={payErrors?.accountId}>
            <NativeSelect
              id={`${p}-acc`}
              name="accountId"
              defaultValue={own[0]?.id ?? ''}
              placeholder={t('chooseAccount')}
              options={own.map((a) => ({ value: a.id, label: a.label }))}
            />
          </FormField>
          <FormField label={t('date')} htmlFor={`${p}-date`}>
            <Input id={`${p}-date`} name="occurredOn" type="date" defaultValue={today} />
          </FormField>
          <FormField
            label={t('amount', { currency })}
            htmlFor={`${p}-amount`}
            error={payErrors?.amount}
          >
            <Input
              id={`${p}-amount`}
              name="amount"
              inputMode="decimal"
              defaultValue={editableDecimal(amount)}
              className="w-32"
            />
          </FormField>
          <FormField
            label={t('fee', { currency: fee?.currency ?? currency })}
            htmlFor={`${p}-fee`}
            error={payErrors?.feeAmount}
          >
            <Input
              id={`${p}-fee`}
              name="feeAmount"
              inputMode="decimal"
              defaultValue={editableDecimal(fee?.amount)}
              className="w-24"
            />
          </FormField>
          {fee && fee.currency !== currency && (
            <FormField label={t('feeAccount')} htmlFor={`${p}-fee-acc`}>
              <NativeSelect
                id={`${p}-fee-acc`}
                name="feeAccountId"
                defaultValue={accounts.find((a) => a.currency === fee.currency)?.id ?? ''}
                options={accounts.map((a) => ({ value: a.id, label: a.label }))}
              />
            </FormField>
          )}
        </>
      )}
      <Button type="submit" size="sm" disabled={paying}>
        {t('record')}
      </Button>
      {payError && <p className="w-full text-sm text-destructive">{payError}</p>}
      {cancel}
    </form>
  );
}
