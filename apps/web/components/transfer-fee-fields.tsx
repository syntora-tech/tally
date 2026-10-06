'use client';

import { useTranslations } from 'next-intl';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { editableDecimal } from '@/lib/format';

export type TransferFeeValues = {
  feeFixed: string | null;
  feePercent: string | null;
  feeCurrency: string | null;
  feeStepFrom?: string | null;
  feeStepFixed?: string | null;
};

/**
 * Bank tariff "fixed + %" of a transfer (A-082) as its own row of a form grid: three short inputs
 * under one caption, so no per-field hint pushes the neighbours out of line.
 */
export function TransferFeeFields({
  idPrefix,
  value,
  errors,
}: {
  idPrefix: string;
  value?: TransferFeeValues | null;
  errors?: Record<string, string[] | undefined>;
}) {
  const t = useTranslations('transferFee');
  return (
    <fieldset className="col-span-full flex flex-col gap-2">
      <legend className="text-sm font-medium">{t('legend')}</legend>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <div className="grid grid-cols-3 items-start gap-3 md:max-w-2xl md:grid-cols-5">
        <FormField label={t('fixed')} htmlFor={`${idPrefix}-fee-fixed`} error={errors?.feeFixed}>
          <Input
            id={`${idPrefix}-fee-fixed`}
            name="feeFixed"
            inputMode="decimal"
            defaultValue={editableDecimal(value?.feeFixed)}
          />
        </FormField>
        <FormField
          label={t('percent')}
          htmlFor={`${idPrefix}-fee-percent`}
          error={errors?.feePercent}
        >
          <Input
            id={`${idPrefix}-fee-percent`}
            name="feePercent"
            inputMode="decimal"
            defaultValue={editableDecimal(value?.feePercent)}
          />
        </FormField>
        <FormField
          label={t('currency')}
          htmlFor={`${idPrefix}-fee-currency`}
          error={errors?.feeCurrency}
        >
          <Input
            id={`${idPrefix}-fee-currency`}
            name="feeCurrency"
            defaultValue={value?.feeCurrency ?? ''}
          />
        </FormField>
        <FormField
          label={t('stepFrom')}
          htmlFor={`${idPrefix}-fee-step-from`}
          error={errors?.feeStepFrom}
        >
          <Input
            id={`${idPrefix}-fee-step-from`}
            name="feeStepFrom"
            inputMode="decimal"
            defaultValue={editableDecimal(value?.feeStepFrom)}
          />
        </FormField>
        <FormField
          label={t('stepFixed')}
          htmlFor={`${idPrefix}-fee-step-fixed`}
          error={errors?.feeStepFixed}
        >
          <Input
            id={`${idPrefix}-fee-step-fixed`}
            name="feeStepFixed"
            inputMode="decimal"
            defaultValue={editableDecimal(value?.feeStepFixed)}
          />
        </FormField>
      </div>
    </fieldset>
  );
}
