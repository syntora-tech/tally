'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { TransferFeeFields, type TransferFeeValues } from '@/components/transfer-fee-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { editableDecimal } from '@/lib/format';
import {
  deletePaymentChargeAction,
  savePaymentChargeAction,
  type PlannedFormState,
} from '@/server/actions/planned';

export function usePlannedFeedback(state: PlannedFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
    else if (state && !state.error.fieldErrors) toast.error(state.error.message);
  }, [state, success]);
  return state && !state.ok ? state.error.fieldErrors : undefined;
}

export type ChargeValues = TransferFeeValues & {
  id: string;
  name: string;
  mode: 'withheld' | 'on_top';
  ratePercent: string;
  categoryId: string;
  currency: string | null;
  counterparty: string | null;
  startsOn: string;
  endsOn: string | null;
};

/**
 * A tax or levy on a payment (A-082): on a planned expense (withheld from the gross or on top) or
 * on every payout of a person (on top only).
 */
export function PaymentChargeForm({
  target,
  value,
  categories,
  thisMonth,
}: {
  target: { plannedExpenseId: string } | { personId: string };
  value?: ChargeValues;
  categories: { value: string; label: string }[];
  thisMonth: string;
}) {
  const [state, action, pending] = useActionState(savePaymentChargeAction, null);
  const t = useTranslations('charges');
  const tc = useTranslations('common');
  const errors = usePlannedFeedback(state, t('saved'));
  const onPlanned = 'plannedExpenseId' in target;
  const p = `charge-${value?.id ?? ('personId' in target ? target.personId : target.plannedExpenseId)}`;
  return (
    <form action={action} className="grid grid-cols-2 items-start gap-3 md:grid-cols-4">
      {value && <input type="hidden" name="id" value={value.id} />}
      {'personId' in target ? (
        <input type="hidden" name="personId" value={target.personId} />
      ) : (
        <input type="hidden" name="plannedExpenseId" value={target.plannedExpenseId} />
      )}
      <FormField label={t('name')} htmlFor={`${p}-name`} error={errors?.name}>
        <Input id={`${p}-name`} name="name" defaultValue={value?.name} />
      </FormField>
      {onPlanned ? (
        <FormField label={t('mode')} htmlFor={`${p}-mode`} error={errors?.mode}>
          <NativeSelect
            id={`${p}-mode`}
            name="mode"
            defaultValue={value?.mode ?? 'on_top'}
            options={[
              { value: 'withheld', label: t('withheld') },
              { value: 'on_top', label: t('onTop') },
            ]}
          />
        </FormField>
      ) : (
        <input type="hidden" name="mode" value="on_top" />
      )}
      <FormField label={t('rate')} htmlFor={`${p}-rate`} error={errors?.ratePercent}>
        <Input
          id={`${p}-rate`}
          name="ratePercent"
          inputMode="decimal"
          defaultValue={editableDecimal(value?.ratePercent)}
        />
      </FormField>
      <FormField label={t('category')} htmlFor={`${p}-category`} error={errors?.categoryId}>
        <NativeSelect
          id={`${p}-category`}
          name="categoryId"
          defaultValue={
            value?.categoryId ?? categories.find((c) => c.label === 'Taxes')?.value ?? ''
          }
          placeholder={t('chooseCategory')}
          options={categories}
        />
      </FormField>
      <FormField label={t('currency')} htmlFor={`${p}-currency`} error={errors?.currency}>
        <Input
          id={`${p}-currency`}
          name="currency"
          defaultValue={value?.currency ?? (onPlanned ? '' : 'UAH')}
          placeholder={onPlanned ? t('samePaymentCurrency') : undefined}
        />
      </FormField>
      <FormField label={t('counterparty')} htmlFor={`${p}-to`} error={errors?.counterparty}>
        <Input id={`${p}-to`} name="counterparty" defaultValue={value?.counterparty ?? ''} />
      </FormField>
      <FormField label={t('startsOn')} htmlFor={`${p}-from`} error={errors?.startsOn}>
        <Input
          id={`${p}-from`}
          name="startsOn"
          type="month"
          defaultValue={(value?.startsOn ?? thisMonth).slice(0, 7)}
        />
      </FormField>
      <FormField label={t('endsOn')} htmlFor={`${p}-until`} error={errors?.endsOn}>
        <Input
          id={`${p}-until`}
          name="endsOn"
          type="month"
          defaultValue={value?.endsOn?.slice(0, 7) ?? ''}
        />
      </FormField>
      <TransferFeeFields idPrefix={p} value={value} errors={errors} />
      <div className="col-span-full">
        <Button type="submit" size="sm" variant={value ? 'outline' : 'default'} disabled={pending}>
          {value ? tc('save') : tc('add')}
        </Button>
      </div>
    </form>
  );
}

export function DeletePaymentChargeButton({ id, personId }: { id: string; personId?: string }) {
  const [state, action, pending] = useActionState(deletePaymentChargeAction, null);
  const t = useTranslations('charges');
  const tc = useTranslations('common');
  usePlannedFeedback(state, t('deleted'));
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t('confirmDelete'))) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      {personId && <input type="hidden" name="personId" value={personId} />}
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
