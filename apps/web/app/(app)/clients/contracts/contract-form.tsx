'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ACT_DATE_TYPES,
  CONTRACT_STATUS_LABELS,
  INVOICE_DATE_TYPES,
  PAYMENT_DUE_TYPES,
  toOptions,
} from '@/lib/labels';
import { saveContract, type FormState } from '@/server/actions/clients';

type Rule = { type: string; day?: number; days?: number; n?: number };

export type ContractFormValues = {
  id?: string;
  kind: 'client' | 'fop';
  number: string;
  signedOn: string | null;
  clientId: string | null;
  payeeId: string | null;
  currency: string;
  paymentDueRule: Rule;
  invoiceDateRule: Rule;
  actDateRule: Rule;
  invoiceTemplateFileId: string | null;
  actTemplateFileId: string | null;
  numberSequenceKey: string | null;
  status: string;
};

type Props = {
  contract: ContractFormValues;
  counterpartyName: string;
};

export function ContractForm({ contract, counterpartyName }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveContract, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const [paymentType, setPaymentType] = useState(contract.paymentDueRule.type);
  const [invoiceType, setInvoiceType] = useState(contract.invoiceDateRule.type);
  const [actType, setActType] = useState(contract.actDateRule.type);
  const isClient = contract.kind === 'client';
  const backHref = contract.id
    ? `/clients/contracts/${contract.id}`
    : isClient
      ? `/clients/${contract.clientId ?? ''}`
      : `/people/payees/${contract.payeeId ?? ''}`;

  return (
    <form action={action} className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
      {contract.id && <input type="hidden" name="id" value={contract.id} />}
      <input type="hidden" name="kind" value={contract.kind} />
      {contract.clientId && <input type="hidden" name="clientId" value={contract.clientId} />}
      {contract.payeeId && <input type="hidden" name="payeeId" value={contract.payeeId} />}
      {state && !state.ok && (
        <Alert variant="destructive" className="md:col-span-2" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground md:col-span-2">
        {isClient ? 'Клієнт' : 'Одержувач (ФОП)'}:{' '}
        <span className="font-medium text-foreground">{counterpartyName}</span>
      </p>
      <FormField label="Номер договору" htmlFor="number" error={errors?.number}>
        <Input
          id="number"
          name="number"
          required
          defaultValue={contract.number}
          placeholder={isClient ? 'MSA №20-08/25' : 'OD-1001'}
        />
      </FormField>
      <FormField label="Дата підписання" htmlFor="signedOn" error={errors?.signedOn}>
        <Input id="signedOn" name="signedOn" type="date" defaultValue={contract.signedOn ?? ''} />
      </FormField>
      <FormField label="Валюта" htmlFor="currency" error={errors?.currency}>
        <Input id="currency" name="currency" defaultValue={contract.currency} />
      </FormField>
      <FormField label="Статус" htmlFor="status" error={errors?.status}>
        <NativeSelect
          id="status"
          name="status"
          defaultValue={contract.status}
          options={toOptions(CONTRACT_STATUS_LABELS)}
        />
      </FormField>

      {isClient && (
        <>
          <FormField label="Строк оплати" htmlFor="paymentDueType" error={errors?.paymentDueRule}>
            <div className="flex gap-2">
              <NativeSelect
                id="paymentDueType"
                name="paymentDueType"
                value={paymentType}
                onChange={(e) => {
                  setPaymentType(e.target.value);
                }}
                options={PAYMENT_DUE_TYPES}
              />
              <Input
                name="paymentDueValue"
                aria-label={paymentType === 'net_days' ? 'Кількість днів' : 'Число місяця'}
                inputMode="numeric"
                className="w-20"
                defaultValue={contract.paymentDueRule.day ?? contract.paymentDueRule.days ?? 20}
              />
            </div>
          </FormField>
          <FormField label="Дата інвойсу" htmlFor="invoiceDateType" error={errors?.invoiceDateRule}>
            <div className="flex gap-2">
              <NativeSelect
                id="invoiceDateType"
                name="invoiceDateType"
                value={invoiceType}
                onChange={(e) => {
                  setInvoiceType(e.target.value);
                }}
                options={INVOICE_DATE_TYPES}
              />
              {invoiceType === 'nth_working_day_after_period' && (
                <Input
                  name="invoiceDateN"
                  aria-label="N-й робочий день"
                  inputMode="numeric"
                  className="w-20"
                  defaultValue={contract.invoiceDateRule.n ?? 3}
                />
              )}
            </div>
          </FormField>
          <FormField label="ID шаблону інвойсу (Google Docs)" htmlFor="invoiceTemplateFileId">
            <Input
              id="invoiceTemplateFileId"
              name="invoiceTemplateFileId"
              defaultValue={contract.invoiceTemplateFileId ?? ''}
            />
          </FormField>
        </>
      )}
      {!isClient && (
        <>
          <input type="hidden" name="paymentDueType" value="day_of_month" />
          <input type="hidden" name="paymentDueValue" value="20" />
          <input type="hidden" name="invoiceDateType" value="first_working_day_after_period" />
        </>
      )}

      <FormField label="Дата акту" htmlFor="actDateType" error={errors?.actDateRule}>
        <div className="flex gap-2">
          <NativeSelect
            id="actDateType"
            name="actDateType"
            value={actType}
            onChange={(e) => {
              setActType(e.target.value);
            }}
            options={ACT_DATE_TYPES}
          />
          {actType === 'nth_working_day_after_period' && (
            <Input
              name="actDateN"
              aria-label="N-й робочий день"
              inputMode="numeric"
              className="w-20"
              defaultValue={contract.actDateRule.n ?? 3}
            />
          )}
        </div>
      </FormField>
      <FormField label="ID шаблону акту (Google Docs)" htmlFor="actTemplateFileId">
        <Input
          id="actTemplateFileId"
          name="actTemplateFileId"
          defaultValue={contract.actTemplateFileId ?? ''}
        />
      </FormField>
      <FormField
        label="Послідовність номерів"
        htmlFor="numberSequenceKey"
        hint={isClient ? 'Напр. invoice' : 'Напр. act:OD-1001'}
      >
        <Input
          id="numberSequenceKey"
          name="numberSequenceKey"
          defaultValue={contract.numberSequenceKey ?? ''}
        />
      </FormField>

      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button variant="ghost" render={<Link href={backHref} />}>
          Скасувати
        </Button>
      </div>
    </form>
  );
}
