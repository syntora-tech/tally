'use client';

import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('clients.form');
  const tc = useTranslations('common');

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
      <FormField label={t('legalName')} htmlFor="legalName" error={errors?.legalName}>
        <Input
          id="legalName"
          name="legalName"
          required
          defaultValue={client?.legalName}
          placeholder="Creditor Group Corp."
        />
      </FormField>
      <FormField label={t('shortName')} htmlFor="shortName" error={errors?.shortName}>
        <Input
          id="shortName"
          name="shortName"
          defaultValue={client?.shortName ?? ''}
          placeholder="Boosty"
        />
      </FormField>
      <FormField label={t('country')} htmlFor="country" error={errors?.country}>
        <Input id="country" name="country" defaultValue={client?.country ?? ''} />
      </FormField>
      <FormField
        label={t('defaultCurrency')}
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
        label={t('address')}
        htmlFor="address"
        className="md:col-span-2"
        hint={t('addressHint')}
      >
        <Textarea id="address" name="address" rows={4} defaultValue={client?.address ?? ''} />
      </FormField>
      <FormField label={t('bankDetails')} htmlFor="bankDetails" className="md:col-span-2">
        <Textarea
          id="bankDetails"
          name="bankDetails"
          rows={4}
          defaultValue={client?.bankDetails ?? ''}
        />
      </FormField>

      <fieldset className="flex flex-col gap-2 md:col-span-2">
        <legend className="mb-1 text-sm font-medium">{t('contacts')}</legend>
        {contacts.map((c, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
            <Input
              aria-label={t('contactName')}
              placeholder={t('contactName')}
              value={c.name}
              onChange={(e) => {
                update(i, { name: e.target.value });
              }}
            />
            <Input
              aria-label={t('contactRole')}
              placeholder={t('contactRole')}
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
              aria-label={t('contactPhone')}
              placeholder={t('contactPhone')}
              value={c.phone ?? ''}
              onChange={(e) => {
                update(i, { phone: e.target.value });
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('removeContact')}
              onClick={() => {
                setContacts((cs) => cs.filter((_, j) => j !== i));
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {errors?.contacts && <p className="text-sm text-destructive">{t('contactsError')}</p>}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            setContacts((cs) => [...cs, { name: '' }]);
          }}
        >
          <Plus className="size-4" /> {t('addContact')}
        </Button>
      </fieldset>

      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : tc('save')}
        </Button>
        <Button
          variant="ghost"
          render={<Link href={client?.id ? `/clients/${client.id}` : '/clients'} />}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}
