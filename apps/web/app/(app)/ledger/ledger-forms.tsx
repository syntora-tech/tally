'use client';

import { Trash2 } from 'lucide-react';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ACCOUNT_KIND_LABELS, TX_TYPE_LABELS, toOptions } from '@/lib/labels';
import {
  deleteTransactionAction,
  saveAccountAction,
  saveCategoryAction,
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
  useFeedback(state, 'Транзакцію видалено');
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Видалити транзакцію з усіма проводками?')) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="icon" variant="ghost" disabled={pending} aria-label="Видалити">
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
  const errors = useFeedback(state, value ? 'Рахунок збережено' : 'Рахунок додано');
  const p = value ? `acc-${value.id}` : 'acc-new';
  return (
    <form action={action} className="grid grid-cols-2 items-end gap-3 md:grid-cols-8">
      {value && <input type="hidden" name="id" value={value.id} />}
      <FormField label="Назва" htmlFor={`${p}-name`} error={errors?.name} className="col-span-2">
        <Input id={`${p}-name`} name="name" defaultValue={value?.name} required />
      </FormField>
      <FormField label="Тип" htmlFor={`${p}-kind`}>
        <NativeSelect
          id={`${p}-kind`}
          name="kind"
          defaultValue={value?.kind ?? 'bank'}
          options={toOptions(ACCOUNT_KIND_LABELS)}
        />
      </FormField>
      <FormField label="Валюта" htmlFor={`${p}-currency`} error={errors?.currency}>
        <Input
          id={`${p}-currency`}
          name="currency"
          defaultValue={value?.currency ?? 'USD'}
          required
        />
      </FormField>
      <FormField label="Мережа" htmlFor={`${p}-network`}>
        <Input
          id={`${p}-network`}
          name="network"
          defaultValue={value?.network ?? ''}
          placeholder="ETH, TRON"
        />
      </FormField>
      <FormField label="Залишок на старті" htmlFor={`${p}-opening`} error={errors?.openingBalance}>
        <Input
          id={`${p}-opening`}
          name="openingBalance"
          inputMode="decimal"
          defaultValue={value?.openingBalance ?? '0'}
        />
      </FormField>
      <FormField label="Дата старту" htmlFor={`${p}-date`} error={errors?.openingDate}>
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
          Активний
        </label>
        <Button type="submit" variant={value ? 'outline' : 'default'} disabled={pending}>
          {value ? 'Зберегти' : 'Додати'}
        </Button>
      </div>
    </form>
  );
}

export function CategoryForm() {
  const [state, action, pending] = useActionState(saveCategoryAction, null);
  const errors = useFeedback(state, 'Категорію додано');
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormField label="Тип" htmlFor="cat-type">
        <NativeSelect
          id="cat-type"
          name="txType"
          defaultValue="expense"
          options={toOptions(TX_TYPE_LABELS)}
        />
      </FormField>
      <FormField label="Назва" htmlFor="cat-name" error={errors?.name}>
        <Input id="cat-name" name="name" required className="w-64" />
      </FormField>
      <Button type="submit" disabled={pending}>
        Додати
      </Button>
    </form>
  );
}
