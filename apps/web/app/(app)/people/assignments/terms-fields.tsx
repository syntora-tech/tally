'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { toOptions, useLabels } from '@/lib/labels';

type Errors = Record<string, string[]> | undefined;

export type BillingDefaults = {
  type: string;
  rate: string;
  currency: string;
  prorationPolicy: string;
  invoiceChannel: string;
};

export type PayDefaults = {
  type: string;
  amount: string;
  currency: string;
  payoutMethod: string;
  releasePolicy: string;
  graceDays: number;
};

/** "60.00000000" → "60" for editing. */
export const editable = (v: string) => (v.includes('.') ? v.replace(/\.?0+$/, '') : v);

/** Client terms block. `prefix` is `billing.` in the create form and empty in the version form. */
export function BillingFields({
  prefix,
  defaults,
  errors,
}: {
  prefix: string;
  defaults: BillingDefaults;
  errors: Errors;
}) {
  const [type, setType] = useState(defaults.type);
  const t = useTranslations('terms');
  const labels = useLabels();
  const id = (f: string) => `${prefix.replace('.', '-')}${f}`;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <FormField label={t('type')} htmlFor={id('type')} error={errors?.[`${prefix}type`]}>
        <NativeSelect
          id={id('type')}
          name={`${prefix}type`}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
          }}
          options={toOptions(labels.BILLING_TYPE_LABELS)}
        />
      </FormField>
      {type !== 'none' && (
        <>
          <FormField
            label={type === 'hourly' ? t('hourlyRate') : t('monthlyAmount')}
            htmlFor={id('rate')}
            error={errors?.[`${prefix}rate`]}
          >
            <Input
              id={id('rate')}
              name={`${prefix}rate`}
              inputMode="decimal"
              required
              defaultValue={editable(defaults.rate)}
            />
          </FormField>
          <FormField label={t('currency')} htmlFor={id('currency')}>
            <Input
              id={id('currency')}
              name={`${prefix}currency`}
              defaultValue={defaults.currency}
            />
          </FormField>
          <FormField label={t('invoiceChannel')} htmlFor={id('invoiceChannel')}>
            <NativeSelect
              id={id('invoiceChannel')}
              name={`${prefix}invoiceChannel`}
              defaultValue={defaults.invoiceChannel}
              options={toOptions(labels.PAYOUT_METHOD_LABELS)}
            />
          </FormField>
          {type === 'fixed_monthly' && (
            <FormField
              label={t('proration')}
              htmlFor={id('prorationPolicy')}
              className="md:col-span-2"
            >
              <NativeSelect
                id={id('prorationPolicy')}
                name={`${prefix}prorationPolicy`}
                defaultValue={defaults.prorationPolicy}
                options={toOptions(labels.PRORATION_LABELS)}
              />
            </FormField>
          )}
        </>
      )}
    </div>
  );
}

/** Person terms block. */
export function PayFields({
  prefix,
  defaults,
  errors,
}: {
  prefix: string;
  defaults: PayDefaults;
  errors: Errors;
}) {
  const [type, setType] = useState(defaults.type);
  const t = useTranslations('terms');
  const labels = useLabels();
  const id = (f: string) => `${prefix.replace('.', '-')}${f}`;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <FormField label={t('type')} htmlFor={id('type')} error={errors?.[`${prefix}type`]}>
        <NativeSelect
          id={id('type')}
          name={`${prefix}type`}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
          }}
          options={toOptions(labels.PAY_TYPE_LABELS)}
        />
      </FormField>
      {type !== 'included' && (
        <>
          <FormField
            label={t('monthlyAmount')}
            htmlFor={id('amount')}
            hint={type === 'fixed' ? t('fixedHint') : t('hourlyHint')}
            error={errors?.[`${prefix}amount`]}
          >
            <Input
              id={id('amount')}
              name={`${prefix}amount`}
              inputMode="decimal"
              required
              defaultValue={editable(defaults.amount)}
            />
          </FormField>
          <FormField label={t('currency')} htmlFor={id('currency')}>
            <Input
              id={id('currency')}
              name={`${prefix}currency`}
              defaultValue={defaults.currency}
            />
          </FormField>
        </>
      )}
      <FormField label={t('payoutMethod')} htmlFor={id('payoutMethod')}>
        <NativeSelect
          id={id('payoutMethod')}
          name={`${prefix}payoutMethod`}
          defaultValue={defaults.payoutMethod}
          options={toOptions(labels.PAYOUT_METHOD_LABELS)}
        />
      </FormField>
      <FormField label={t('releasePolicy')} htmlFor={id('releasePolicy')}>
        <NativeSelect
          id={id('releasePolicy')}
          name={`${prefix}releasePolicy`}
          defaultValue={defaults.releasePolicy}
          options={toOptions(labels.RELEASE_POLICY_LABELS)}
        />
      </FormField>
      <FormField label={t('graceDays')} htmlFor={id('graceDays')}>
        <Input
          id={id('graceDays')}
          name={`${prefix}graceDays`}
          inputMode="numeric"
          defaultValue={defaults.graceDays}
        />
      </FormField>
    </div>
  );
}
