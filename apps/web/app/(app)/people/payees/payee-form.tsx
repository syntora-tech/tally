'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { NetworkSelect } from '@/components/network-select';
import { TransferFeeFields, type TransferFeeValues } from '@/components/transfer-fee-fields';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toOptions, useLabels } from '@/lib/labels';
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
} & Partial<TransferFeeValues>;

type Props = {
  payee?: PayeeFormValues;
  people: { value: string; label: string }[];
  defaultPersonId?: string;
};

export function PayeeForm({ payee, people, defaultPersonId }: Props) {
  const [state, action, pending] = useActionState<PayeeFormState, FormData>(savePayee, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('payees.form');
  const tc = useTranslations('common');
  const { PAYEE_KIND_LABELS } = useLabels();

  return (
    <form action={action} className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      {payee?.id && <input type="hidden" name="id" value={payee.id} />}
      {state && !state.ok && (
        <Alert variant="destructive" className="md:col-span-2" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label={t('kind')} htmlFor="kind" error={errors?.kind}>
        <NativeSelect
          id="kind"
          name="kind"
          defaultValue={payee?.kind ?? 'fop'}
          options={toOptions(PAYEE_KIND_LABELS)}
        />
      </FormField>
      <FormField
        label={t('person')}
        htmlFor="personId"
        hint={t('personHint')}
        error={errors?.personId}
      >
        <NativeSelect
          id="personId"
          name="personId"
          defaultValue={payee?.personId ?? defaultPersonId ?? ''}
          placeholder={t('notLinked')}
          options={people}
        />
      </FormField>
      <FormField label={t('nameUa')} htmlFor="legalNameUa" error={errors?.legalNameUa}>
        <Input
          id="legalNameUa"
          name="legalNameUa"
          defaultValue={payee?.legalNameUa ?? ''}
          placeholder="ФОП Щурко Віталія …"
        />
      </FormField>
      <FormField label={t('nameEn')} htmlFor="legalNameEn" error={errors?.legalNameEn}>
        <Input id="legalNameEn" name="legalNameEn" defaultValue={payee?.legalNameEn ?? ''} />
      </FormField>
      <FormField label={t('taxId')} htmlFor="taxId" error={errors?.taxId}>
        <Input id="taxId" name="taxId" inputMode="numeric" defaultValue={payee?.taxId ?? ''} />
      </FormField>
      <FormField label={t('edrRecord')} htmlFor="edrRecord" error={errors?.edrRecord}>
        <Input id="edrRecord" name="edrRecord" defaultValue={payee?.edrRecord ?? ''} />
      </FormField>
      <FormField label={t('edrDate')} htmlFor="edrDate" error={errors?.edrDate}>
        <Input id="edrDate" name="edrDate" type="date" defaultValue={payee?.edrDate ?? ''} />
      </FormField>
      <FormField label="IBAN" htmlFor="iban" error={errors?.iban}>
        <Input id="iban" name="iban" defaultValue={payee?.iban ?? ''} placeholder="UA…" />
      </FormField>
      <FormField label={t('bank')} htmlFor="bankName" error={errors?.bankName}>
        <Input id="bankName" name="bankName" defaultValue={payee?.bankName ?? ''} />
      </FormField>
      <FormField
        label={t('address')}
        htmlFor="addressUa"
        className="md:col-span-2"
        error={errors?.addressUa}
      >
        <Textarea id="addressUa" name="addressUa" rows={2} defaultValue={payee?.addressUa ?? ''} />
      </FormField>
      <FormField label={t('wallet')} htmlFor="walletAddress" error={errors?.walletAddress}>
        <Input id="walletAddress" name="walletAddress" defaultValue={payee?.walletAddress ?? ''} />
      </FormField>
      <FormField label={t('network')} htmlFor="walletNetwork" error={errors?.walletNetwork}>
        <NetworkSelect
          id="walletNetwork"
          name="walletNetwork"
          defaultValue={payee?.walletNetwork ?? ''}
          placeholder="—"
        />
      </FormField>
      <p className="text-sm font-medium md:col-span-2">{t('fee')}</p>
      <div className="grid grid-cols-3 gap-3 md:col-span-2">
        <TransferFeeFields
          idPrefix="payee"
          errors={errors}
          value={
            payee
              ? {
                  feeFixed: payee.feeFixed ?? null,
                  feePercent: payee.feePercent ?? null,
                  feeCurrency: payee.feeCurrency ?? null,
                }
              : null
          }
        />
      </div>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : tc('save')}
        </Button>
        <Button
          variant="ghost"
          render={<Link href={payee?.id ? `/people/payees/${payee.id}` : '/people/payees'} />}
        >
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}
