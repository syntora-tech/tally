'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { editableDecimal } from '@/lib/format';
import {
  deletePlannedExpenseAction,
  savePlannedExpenseAction,
  type PlannedFormState,
} from '@/server/actions/planned';

function useFeedback(state: PlannedFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
    else if (state && !state.error.fieldErrors) toast.error(state.error.message);
  }, [state, success]);
  return state && !state.ok ? state.error.fieldErrors : undefined;
}

export type PlannedValues = {
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
};

export function PlannedExpenseForm({
  value,
  categories,
  thisMonth,
}: {
  value?: PlannedValues;
  categories: { value: string; label: string }[];
  thisMonth: string;
}) {
  const [state, action, pending] = useActionState(savePlannedExpenseAction, null);
  const t = useTranslations('planned');
  const tm = useTranslations('months');
  const tc = useTranslations('common');
  const errors = useFeedback(state, value ? t('saved') : t('added'));
  const [frequency, setFrequency] = useState(value?.frequency ?? 'monthly');
  const p = value ? `pe-${value.id}` : 'pe-new';
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: tm(String(i + 1) as '1'),
  }));
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-3 md:grid-cols-6">
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
      <FormField label={t('notes')} htmlFor={`${p}-notes`} className="col-span-2">
        <Input id={`${p}-notes`} name="notes" defaultValue={value?.notes ?? ''} />
      </FormField>
      <div className="flex h-9 items-center">
        <Button type="submit" variant={value ? 'outline' : 'default'} disabled={pending}>
          {value ? tc('save') : tc('add')}
        </Button>
      </div>
    </form>
  );
}

export function DeletePlannedExpenseButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deletePlannedExpenseAction, null);
  const t = useTranslations('planned');
  const tc = useTranslations('common');
  useFeedback(state, t('deleted'));
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(t('confirmDelete'))) e.preventDefault();
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
