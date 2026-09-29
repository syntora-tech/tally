'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ALLOCATION_LABELS, PERSON_STATUS_LABELS, toOptions } from '@/lib/labels';
import { savePerson, type PersonFormState } from '@/server/actions/people';

export type PersonFormValues = {
  id?: string;
  fullName: string;
  displayName: string | null;
  position: string | null;
  seniority: string[];
  stack: string[];
  domains: string[];
  marketRateUsd: string | null;
  allocation: string | null;
  availabilityFrom: string | null;
  location: string | null;
  timezone: string | null;
  contactOwner: string | null;
  status: string;
  notes: string | null;
};

/** Drops trailing zeros of numeric(20,8) values for editing: "60.00000000" → "60". */
function editableDecimal(v: string | null): string {
  if (!v) return '';
  return v.includes('.') ? v.replace(/\.?0+$/, '') : v;
}

export function PersonForm({ person }: { person?: PersonFormValues }) {
  const [state, action, pending] = useActionState<PersonFormState, FormData>(savePerson, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const cancelHref = person?.id ? `/people/${person.id}` : '/people';

  return (
    <form action={action} className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      {person?.id && <input type="hidden" name="id" value={person.id} />}
      {state && !state.ok && (
        <Alert variant="destructive" className="md:col-span-2" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label="Повне ім’я" htmlFor="fullName" error={errors?.fullName}>
        <Input id="fullName" name="fullName" defaultValue={person?.fullName} required />
      </FormField>
      <FormField label="Коротке ім’я" htmlFor="displayName" error={errors?.displayName}>
        <Input id="displayName" name="displayName" defaultValue={person?.displayName ?? ''} />
      </FormField>
      <FormField label="Позиція" htmlFor="position" error={errors?.position}>
        <Input
          id="position"
          name="position"
          defaultValue={person?.position ?? ''}
          placeholder="DevOps Engineer"
        />
      </FormField>
      <FormField label="Сеньйорність" htmlFor="seniority" hint="Через кому: Lead, Senior">
        <Input id="seniority" name="seniority" defaultValue={person?.seniority.join(', ')} />
      </FormField>
      <FormField
        label="Стек"
        htmlFor="stack"
        hint="Через кому: Solidity, TypeScript, AWS"
        className="md:col-span-2"
      >
        <Input id="stack" name="stack" defaultValue={person?.stack.join(', ')} />
      </FormField>
      <FormField
        label="Домени"
        htmlFor="domains"
        hint="Через кому: DeFi, NFT"
        className="md:col-span-2"
      >
        <Input id="domains" name="domains" defaultValue={person?.domains.join(', ')} />
      </FormField>
      <FormField
        label="Ринкова ставка, $/год"
        htmlFor="marketRateUsd"
        error={errors?.marketRateUsd}
      >
        <Input
          id="marketRateUsd"
          name="marketRateUsd"
          inputMode="decimal"
          defaultValue={editableDecimal(person?.marketRateUsd ?? null)}
        />
      </FormField>
      <FormField label="Формат" htmlFor="allocation" error={errors?.allocation}>
        <NativeSelect
          id="allocation"
          name="allocation"
          defaultValue={person?.allocation ?? ''}
          placeholder="Не вказано"
          options={toOptions(ALLOCATION_LABELS)}
        />
      </FormField>
      <FormField
        label="Доступний з"
        htmlFor="availabilityFrom"
        hint="Порожньо — доступний зараз"
        error={errors?.availabilityFrom}
      >
        <Input
          id="availabilityFrom"
          name="availabilityFrom"
          type="date"
          defaultValue={person?.availabilityFrom ?? ''}
        />
      </FormField>
      <FormField label="Статус" htmlFor="status" error={errors?.status}>
        <NativeSelect
          id="status"
          name="status"
          defaultValue={person?.status ?? 'active'}
          options={toOptions(PERSON_STATUS_LABELS)}
        />
      </FormField>
      <FormField label="Локація" htmlFor="location">
        <Input
          id="location"
          name="location"
          defaultValue={person?.location ?? ''}
          placeholder="Ukraine"
        />
      </FormField>
      <FormField label="Часовий пояс" htmlFor="timezone">
        <Input
          id="timezone"
          name="timezone"
          defaultValue={person?.timezone ?? ''}
          placeholder="UTC+3"
        />
      </FormField>
      <FormField label="Контактна особа" htmlFor="contactOwner">
        <Input
          id="contactOwner"
          name="contactOwner"
          defaultValue={person?.contactOwner ?? ''}
          placeholder="@alina_syntora"
        />
      </FormField>
      <FormField label="Нотатки" htmlFor="notes" className="md:col-span-2">
        <Textarea id="notes" name="notes" defaultValue={person?.notes ?? ''} rows={3} />
      </FormField>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button variant="ghost" render={<Link href={cancelHref} />}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}
