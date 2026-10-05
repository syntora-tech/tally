'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addTripExpenseAction,
  createReimbursementAction,
  deleteTripExpenseAction,
  payReimbursementAction,
  type TripFormState,
} from '@/server/actions/trips';

type Option = { value: string; label: string };

function useOutcome(state: TripFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
  }, [state, success]);
  return state && !state.ok ? state.error : null;
}

function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** New expense (6.8): rate defaults to NBU on the date; company-paid goes to the Ledger. */
export function ExpenseForm(p: {
  tripId: string;
  people: Option[];
  defaultDate: string;
  accounts: Option[];
  candidates: Option[];
}) {
  const [state, action, pending] = useActionState<TripFormState, FormData>(
    addTripExpenseAction,
    null,
  );
  const t = useTranslations('trips');
  const error = useOutcome(state, t('expenseAdded'));
  const errors = error?.fieldErrors;
  const [paidBy, setPaidBy] = useState<'person' | 'company'>('person');
  const [ledger, setLedger] = useState<'new' | 'existing'>('new');
  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="tripId" value={p.tripId} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t('expense.person')} htmlFor="exp-person" error={errors?.personId}>
          <NativeSelect id="exp-person" name="personId" options={p.people} />
        </FormField>
        <FormField label={t('expense.date')} htmlFor="exp-date" error={errors?.spentOn}>
          <Input id="exp-date" name="spentOn" type="date" defaultValue={p.defaultDate} />
        </FormField>
        <FormField
          label={t('expense.description')}
          htmlFor="exp-description"
          error={errors?.description}
        >
          <Input id="exp-description" name="description" className="w-56" required />
        </FormField>
        <FormField label={t('expense.amount')} htmlFor="exp-amount" error={errors?.amount}>
          <Input id="exp-amount" name="amount" inputMode="decimal" className="w-28" required />
        </FormField>
        <FormField label={t('expense.currency')} htmlFor="exp-currency" error={errors?.currency}>
          <Input id="exp-currency" name="currency" defaultValue="EUR" className="w-20" />
        </FormField>
        <FormField label={t('expense.rate')} htmlFor="exp-rate" error={errors?.fxRate}>
          <Input
            id="exp-rate"
            name="fxRate"
            inputMode="decimal"
            placeholder={t('expense.rateHint')}
            className="w-32"
          />
        </FormField>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t('expense.paidBy')} htmlFor="exp-paid-by">
          <NativeSelect
            id="exp-paid-by"
            name="paidBy"
            value={paidBy}
            onChange={(e) => {
              setPaidBy(e.target.value === 'company' ? 'company' : 'person');
            }}
            options={[
              { value: 'person', label: t('paidBy.person') },
              { value: 'company', label: t('paidBy.company') },
            ]}
          />
        </FormField>
        {paidBy === 'person' ? (
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" name="reimbursable" defaultChecked />
            {t('expense.reimbursable')}
          </label>
        ) : (
          <>
            <FormField label={t('expense.ledger')} htmlFor="exp-ledger">
              <NativeSelect
                id="exp-ledger"
                value={ledger}
                onChange={(e) => {
                  setLedger(e.target.value === 'existing' ? 'existing' : 'new');
                }}
                options={[
                  { value: 'new', label: t('ledgerNew') },
                  { value: 'existing', label: t('ledgerExisting') },
                ]}
              />
            </FormField>
            {ledger === 'new' ? (
              <>
                <FormField
                  label={t('expense.account')}
                  htmlFor="exp-account"
                  error={errors?.accountId}
                >
                  <NativeSelect
                    id="exp-account"
                    name="accountId"
                    placeholder={t('chooseAccount')}
                    options={p.accounts}
                  />
                </FormField>
                <FormField
                  label={t('expense.accountAmount')}
                  htmlFor="exp-account-amount"
                  error={errors?.accountAmount}
                >
                  <Input
                    id="exp-account-amount"
                    name="accountAmount"
                    inputMode="decimal"
                    className="w-28"
                  />
                </FormField>
              </>
            ) : (
              <FormField
                label={t('expense.transaction')}
                htmlFor="exp-transaction"
                error={errors?.transactionId ?? errors?.accountId}
              >
                <NativeSelect
                  id="exp-transaction"
                  name="transactionId"
                  placeholder={t('chooseTransaction')}
                  options={p.candidates}
                />
              </FormField>
            )}
          </>
        )}
        <FormField label={t('expense.receipt')} htmlFor="exp-receipt" error={errors?.receipt}>
          <Input id="exp-receipt" name="receipt" type="file" accept="image/*,application/pdf" />
        </FormField>
      </div>
      {errors?.allowDuplicate && (
        <label className="flex items-center gap-2 text-sm text-destructive">
          <input type="checkbox" name="allowDuplicate" />
          {errors.allowDuplicate.join(' ')} {t('recordAnyway')}
        </label>
      )}
      <FormAlert message={error && !errors ? error.message : undefined} />
      <Button type="submit" disabled={pending} className="self-start">
        {t('addExpense')}
      </Button>
    </form>
  );
}

export function DeleteExpenseButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<TripFormState, FormData>(
    deleteTripExpenseAction,
    null,
  );
  const t = useTranslations('trips');
  const tc = useTranslations('common');
  useOutcome(state, t('expenseDeleted'));
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t('confirmDeleteExpense'))) e.preventDefault();
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

/** Reimbursement (6.8): payout adjustment, extra act or direct payment. */
export function ReimbursementForm(p: {
  tripId: string;
  people: (Option & { remaining: string; payeeId: string | null })[];
  periods: Option[];
  payees: Option[];
  today: string;
}) {
  const [state, action, pending] = useActionState<TripFormState, FormData>(
    createReimbursementAction,
    null,
  );
  const t = useTranslations('trips');
  const error = useOutcome(state, t('reimbursementCreated'));
  const errors = error?.fieldErrors;
  const [personId, setPersonId] = useState(p.people[0]?.value ?? '');
  const [method, setMethod] = useState<'payroll' | 'act' | 'direct_payment'>('act');
  const person = p.people.find((x) => x.value === personId);
  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="tripId" value={p.tripId} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t('expense.person')} htmlFor="re-person" error={errors?.personId}>
          <NativeSelect
            id="re-person"
            name="personId"
            value={personId}
            onChange={(e) => {
              setPersonId(e.target.value);
            }}
            options={p.people}
          />
        </FormField>
        <FormField label={t('reimbursement.amount')} htmlFor="re-amount" error={errors?.amount}>
          <Input
            id="re-amount"
            name="amount"
            inputMode="decimal"
            key={personId}
            defaultValue={person?.remaining ?? ''}
            className="w-32"
          />
        </FormField>
        <FormField label={t('reimbursement.method')} htmlFor="re-method">
          <NativeSelect
            id="re-method"
            name="method"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as typeof method);
            }}
            options={(['act', 'payroll', 'direct_payment'] as const).map((m) => ({
              value: m,
              label: t(`method.${m}`),
            }))}
          />
        </FormField>
        {method === 'payroll' && (
          <FormField label={t('reimbursement.period')} htmlFor="re-period" error={errors?.periodId}>
            <NativeSelect
              id="re-period"
              name="periodId"
              placeholder={t('choosePeriod')}
              options={p.periods}
            />
          </FormField>
        )}
        {method !== 'payroll' && (
          <FormField label={t('reimbursement.payee')} htmlFor="re-payee" error={errors?.payeeId}>
            <NativeSelect
              id="re-payee"
              name="payeeId"
              key={personId}
              defaultValue={person?.payeeId ?? ''}
              placeholder={t('choosePayee')}
              options={p.payees}
            />
          </FormField>
        )}
        {method === 'act' && (
          <FormField
            label={t('reimbursement.actDate')}
            htmlFor="re-act-date"
            error={errors?.actDate}
          >
            <Input id="re-act-date" name="actDate" type="date" defaultValue={p.today} />
          </FormField>
        )}
      </div>
      <FormAlert message={error && !errors ? error.message : undefined} />
      <Button type="submit" disabled={pending} className="self-start">
        {t('createReimbursement')}
      </Button>
    </form>
  );
}

export function PayReimbursementForm(p: {
  reimbursementId: string;
  remaining: string;
  today: string;
  accounts: Option[];
  candidates: Option[];
}) {
  const [state, action, pending] = useActionState<TripFormState, FormData>(
    payReimbursementAction,
    null,
  );
  const t = useTranslations('trips');
  const error = useOutcome(state, t('reimbursementPaid'));
  const errors = error?.fieldErrors;
  const [source, setSource] = useState<'new' | 'existing'>('new');
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="reimbursementId" value={p.reimbursementId} />
      <FormField
        label={t('reimbursement.amount')}
        htmlFor={`pay-${p.reimbursementId}`}
        error={errors?.amount}
      >
        <Input
          id={`pay-${p.reimbursementId}`}
          name="amount"
          inputMode="decimal"
          defaultValue={p.remaining}
          className="w-28"
        />
      </FormField>
      <FormField label={t('expense.ledger')} htmlFor={`pay-src-${p.reimbursementId}`}>
        <NativeSelect
          id={`pay-src-${p.reimbursementId}`}
          value={source}
          onChange={(e) => {
            setSource(e.target.value === 'existing' ? 'existing' : 'new');
          }}
          options={[
            { value: 'new', label: t('ledgerNew') },
            { value: 'existing', label: t('ledgerExisting') },
          ]}
        />
      </FormField>
      {source === 'new' ? (
        <>
          <FormField
            label={t('expense.account')}
            htmlFor={`pay-acc-${p.reimbursementId}`}
            error={errors?.accountId}
          >
            <NativeSelect
              id={`pay-acc-${p.reimbursementId}`}
              name="accountId"
              placeholder={t('chooseAccount')}
              options={p.accounts}
            />
          </FormField>
          <FormField label={t('expense.date')} htmlFor={`pay-date-${p.reimbursementId}`}>
            <Input
              id={`pay-date-${p.reimbursementId}`}
              name="occurredOn"
              type="date"
              defaultValue={p.today}
            />
          </FormField>
        </>
      ) : (
        <FormField
          label={t('expense.transaction')}
          htmlFor={`pay-tx-${p.reimbursementId}`}
          error={errors?.transactionId ?? errors?.accountId}
        >
          <NativeSelect
            id={`pay-tx-${p.reimbursementId}`}
            name="transactionId"
            placeholder={t('chooseTransaction')}
            options={p.candidates}
          />
        </FormField>
      )}
      <Button type="submit" size="sm" disabled={pending}>
        {t('pay')}
      </Button>
      <div className="w-full">
        <FormAlert message={error && !errors ? error.message : undefined} />
      </div>
    </form>
  );
}
