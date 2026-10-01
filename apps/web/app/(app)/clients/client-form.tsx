'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saveClient, type FormState } from '@/server/actions/clients';

type Contact = { name: string; role?: string; email?: string; phone?: string };

export type ClientFormValues = {
  id?: string;
  legalName: string;
  shortName: string | null;
  address: string | null;
  country: string | null;
  bankDetails: string | null;
  contacts: Contact[];
  defaultCurrency: string;
};

export function ClientForm({ client }: { client?: ClientFormValues }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveClient, null);
  const [contacts, setContacts] = useState<Contact[]>(client?.contacts ?? []);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;

  const update = (i: number, patch: Partial<Contact>) => {
    setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  return (
    <form action={action} className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
      {client?.id && <input type="hidden" name="id" value={client.id} />}
      <input type="hidden" name="contacts" value={JSON.stringify(contacts)} />
      {state && !state.ok && (
        <Alert variant="destructive" className="md:col-span-2" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label="Юридична назва" htmlFor="legalName" error={errors?.legalName}>
        <Input
          id="legalName"
          name="legalName"
          required
          defaultValue={client?.legalName}
          placeholder="Creditor Group Corp."
        />
      </FormField>
      <FormField label="Коротка назва" htmlFor="shortName" error={errors?.shortName}>
        <Input
          id="shortName"
          name="shortName"
          defaultValue={client?.shortName ?? ''}
          placeholder="Boosty"
        />
      </FormField>
      <FormField label="Країна" htmlFor="country" error={errors?.country}>
        <Input id="country" name="country" defaultValue={client?.country ?? ''} />
      </FormField>
      <FormField
        label="Валюта за замовчуванням"
        htmlFor="defaultCurrency"
        error={errors?.defaultCurrency}
      >
        <Input
          id="defaultCurrency"
          name="defaultCurrency"
          defaultValue={client?.defaultCurrency ?? 'USD'}
        />
      </FormField>
      <FormField
        label="Адреса та реєстраційні дані"
        htmlFor="address"
        className="md:col-span-2"
        hint="Як у шапці інвойсу: адреса, File number, Represented by…"
      >
        <Textarea id="address" name="address" rows={4} defaultValue={client?.address ?? ''} />
      </FormField>
      <FormField label="Банківські реквізити" htmlFor="bankDetails" className="md:col-span-2">
        <Textarea
          id="bankDetails"
          name="bankDetails"
          rows={4}
          defaultValue={client?.bankDetails ?? ''}
        />
      </FormField>

      <fieldset className="flex flex-col gap-2 md:col-span-2">
        <legend className="mb-1 text-sm font-medium">Контакти</legend>
        {contacts.map((c, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <Input
              aria-label="Ім’я"
              placeholder="Ім’я"
              value={c.name}
              onChange={(e) => {
                update(i, { name: e.target.value });
              }}
            />
            <Input
              aria-label="Роль"
              placeholder="Роль"
              value={c.role ?? ''}
              onChange={(e) => {
                update(i, { role: e.target.value });
              }}
            />
            <Input
              aria-label="Email"
              placeholder="Email"
              type="email"
              value={c.email ?? ''}
              onChange={(e) => {
                update(i, { email: e.target.value });
              }}
            />
            <Input
              aria-label="Телефон"
              placeholder="Телефон"
              value={c.phone ?? ''}
              onChange={(e) => {
                update(i, { phone: e.target.value });
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Видалити контакт"
              onClick={() => {
                setContacts((cs) => cs.filter((_, j) => j !== i));
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {errors?.contacts && (
          <p className="text-sm text-destructive">
            Перевірте контакти: ім’я обов’язкове, email — коректний
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setContacts((cs) => [...cs, { name: '' }]);
          }}
        >
          <Plus className="size-4" /> Додати контакт
        </Button>
      </fieldset>

      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button
          variant="ghost"
          render={<Link href={client?.id ? `/clients/${client.id}` : '/clients'} />}
        >
          Скасувати
        </Button>
      </div>
    </form>
  );
}
