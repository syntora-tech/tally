'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toOptions, useLabels } from '@/lib/labels';
import {
  deleteTransactionAction,
  saveAccountAction,
  saveCategoryAction,
  saveManualRateAction,
  type LedgerFormState,
} from '@/server/actions/ledger';

function useFeedback(state: LedgerFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
    else if (state && !state.error.fieldErrors) toast.error(state.error.message);
  }, [state, success]);
  return state && !state.ok ? state.error.fieldErrors : undefined;
}

export function DeleteTransactionButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteTransactionAction, null);
  const t = useTranslations('ledgerForms');
  const tc = useTranslations('common');
  useFeedback(state, t('txDeleted'));
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

export type AccountValues = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  network: string | null;
  openingBalance: string;
  openingDate: string;
  isActive: boolean;
};

export function AccountForm({ value, today }: { value?: AccountValues; today: string }) {
  const [state, action, pending] = useActionState(saveAccountAction, null);
  const t = useTranslations('ledgerForms');
  const tc = useTranslations('common');
  const { ACCOUNT_KIND_LABELS } = useLabels();
  const errors = useFeedback(state, value ? t('accountSaved') : t('accountAdded'));
  const p = value ? `acc-${value.id}` : 'acc-new';
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-3 md:grid-cols-8">
      {value && <input type="hidden" name="id" value={value.id} />}
      <FormField
        label={t('name')}
        htmlFor={`${p}-name`}
        error={errors?.name}
        className="col-span-2"
      >
        <Input id={`${p}-name`} name="name" defaultValue={value?.name} required />
      </FormField>
      <FormField label={t('kind')} htmlFor={`${p}-kind`}>
        <NativeSelect
          id={`${p}-kind`}
          name="kind"
          defaultValue={value?.kind ?? 'bank'}
          options={toOptions(ACCOUNT_KIND_LABELS)}
        />
      </FormField>
      <FormField label={t('currency')} htmlFor={`${p}-currency`} error={errors?.currency}>
        <Input
          id={`${p}-currency`}
          name="currency"
          defaultValue={value?.currency ?? 'USD'}
          required
        />
      </FormField>
      <FormField label={t('network')} htmlFor={`${p}-network`}>
        <Input
          id={`${p}-network`}
          name="network"
          defaultValue={value?.network ?? ''}
          placeholder="ETH, TRON"
        />
      </FormField>
      <FormField label={t('opening')} htmlFor={`${p}-opening`} error={errors?.openingBalance}>
        <Input
          id={`${p}-opening`}
          name="openingBalance"
          inputMode="decimal"
          defaultValue={value?.openingBalance ?? '0'}
        />
      </FormField>
      <FormField label={t('openingDate')} htmlFor={`${p}-date`} error={errors?.openingDate}>
        <Input
          id={`${p}-date`}
          name="openingDate"
          type="date"
          defaultValue={value?.openingDate ?? today}
        />
      </FormField>
      <div className="flex h-9 items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={value?.isActive ?? true} />{' '}
          {t('active')}
        </label>
        <Button type="submit" variant={value ? 'outline' : 'default'} disabled={pending}>
          {value ? tc('save') : tc('add')}
        </Button>
      </div>
    </form>
  );
}

export function CategoryForm() {
  const [state, action, pending] = useActionState(saveCategoryAction, null);
  const t = useTranslations('ledgerForms');
  const tc = useTranslations('common');
  const { TX_TYPE_LABELS } = useLabels();
  const errors = useFeedback(state, t('categoryAdded'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormField label={t('kind')} htmlFor="cat-type">
        <NativeSelect
          id="cat-type"
          name="txType"
          defaultValue="expense"
          options={toOptions(TX_TYPE_LABELS)}
        />
      </FormField>
      <FormField label={t('name')} htmlFor="cat-name" error={errors?.name}>
        <Input id="cat-name" name="name" required className="w-64" />
      </FormField>
      <Button type="submit" disabled={pending}>
        {tc('add')}
      </Button>
    </form>
  );
}

export function ManualRateForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(saveManualRateAction, null);
  const t = useTranslations('ledgerForms');
  const errors = useFeedback(state, t('rateSaved'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormField label={t('date')} htmlFor="rate-date" error={errors?.onDate}>
        <Input id="rate-date" name="onDate" type="date" defaultValue={today} />
      </FormField>
      <FormField label={t('currency')} htmlFor="rate-base" error={errors?.base}>
        <Input id="rate-base" name="base" defaultValue="USD" className="w-24" />
      </FormField>
      <FormField label={t('rateUah')} htmlFor="rate-value" error={errors?.rate}>
        <Input id="rate-value" name="rate" inputMode="decimal" className="w-32" required />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {t('saveManualRate')}
      </Button>
    </form>
  );
}
