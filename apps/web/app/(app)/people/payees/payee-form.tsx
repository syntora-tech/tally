'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PAYEE_KIND_LABELS, toOptions } from '@/lib/labels';
import { savePayee, type PayeeFormState } from '@/server/actions/payees';

export type PayeeFormValues = {
  id?: string;
  kind: string;
  legalNameUa: string | null;
  legalNameEn: string | null;
  taxId: string | null;
  edrRecord: string | null;
  edrDate: string | null;
  addressUa: string | null;
  iban: string | null;
  bankName: string | null;
  walletAddress: string | null;
  walletNetwork: string | null;
  personId: string | null;
};

type Props = {
  payee?: PayeeFormValues;
  people: { value: string; label: string }[];
  defaultPersonId?: string;
};

export function PayeeForm({ payee, people, defaultPersonId }: Props) {
  const [state, action, pending] = useActionState<PayeeFormState, FormData>(savePayee, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;

  return (
    <form action={action} className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      {payee?.id && <input type="hidden" name="id" value={payee.id} />}
      {state && !state.ok && (
        <Alert variant="destructive" className="md:col-span-2" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label="Тип" htmlFor="kind" error={errors?.kind}>
        <NativeSelect
          id="kind"
          name="kind"
          defaultValue={payee?.kind ?? 'fop'}
          options={toOptions(PAYEE_KIND_LABELS)}
        />
      </FormField>
      <FormField
        label="Людина"
        htmlFor="personId"
        hint="Необов’язково: одержувач не завжди та сама людина"
        error={errors?.personId}
      >
        <NativeSelect
          id="personId"
          name="personId"
          defaultValue={payee?.personId ?? defaultPersonId ?? ''}
          placeholder="Не прив’язано"
          options={people}
        />
      </FormField>
      <FormField label="Назва українською" htmlFor="legalNameUa" error={errors?.legalNameUa}>
        <Input
          id="legalNameUa"
          name="legalNameUa"
          defaultValue={payee?.legalNameUa ?? ''}
          placeholder="ФОП Щурко Віталія …"
        />
      </FormField>
      <FormField label="Назва англійською" htmlFor="legalNameEn" error={errors?.legalNameEn}>
        <Input id="legalNameEn" name="legalNameEn" defaultValue={payee?.legalNameEn ?? ''} />
      </FormField>
      <FormField label="ІПН / РНОКПП" htmlFor="taxId" error={errors?.taxId}>
        <Input id="taxId" name="taxId" inputMode="numeric" defaultValue={payee?.taxId ?? ''} />
      </FormField>
      <FormField label="Запис у ЄДР" htmlFor="edrRecord" error={errors?.edrRecord}>
        <Input id="edrRecord" name="edrRecord" defaultValue={payee?.edrRecord ?? ''} />
      </FormField>
      <FormField label="Дата запису в ЄДР" htmlFor="edrDate" error={errors?.edrDate}>
        <Input id="edrDate" name="edrDate" type="date" defaultValue={payee?.edrDate ?? ''} />
      </FormField>
      <FormField label="IBAN" htmlFor="iban" error={errors?.iban}>
        <Input id="iban" name="iban" defaultValue={payee?.iban ?? ''} placeholder="UA…" />
      </FormField>
      <FormField label="Банк" htmlFor="bankName" error={errors?.bankName}>
        <Input id="bankName" name="bankName" defaultValue={payee?.bankName ?? ''} />
      </FormField>
      <FormField
        label="Адреса"
        htmlFor="addressUa"
        className="md:col-span-2"
        error={errors?.addressUa}
      >
        <Textarea id="addressUa" name="addressUa" rows={2} defaultValue={payee?.addressUa ?? ''} />
      </FormField>
      <FormField label="Адреса гаманця" htmlFor="walletAddress" error={errors?.walletAddress}>
        <Input id="walletAddress" name="walletAddress" defaultValue={payee?.walletAddress ?? ''} />
      </FormField>
      <FormField label="Мережа" htmlFor="walletNetwork" error={errors?.walletNetwork}>
        <Input
          id="walletNetwork"
          name="walletNetwork"
          defaultValue={payee?.walletNetwork ?? ''}
          placeholder="TRON, Ethereum"
        />
      </FormField>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button
          variant="ghost"
          render={<Link href={payee?.id ? `/people/payees/${payee.id}` : '/people/payees'} />}
        >
          Скасувати
        </Button>
      </div>
    </form>
  );
}
