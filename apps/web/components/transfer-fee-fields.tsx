'use client';

import { useTranslations } from 'next-intl';
import { FormField } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { editableDecimal } from '@/lib/format';

export type TransferFeeValues = {
  feeFixed: string | null;
  feePercent: string | null;
  feeCurrency: string | null;
};

/** Bank tariff "fixed + %" of a transfer (A-082): three inputs that sit in a form grid. */
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
    <>
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
        hint={t('currencyHint')}
        error={errors?.feeCurrency}
      >
        <Input
          id={`${idPrefix}-fee-currency`}
          name="feeCurrency"
          defaultValue={value?.feeCurrency ?? ''}
          placeholder="UAH"
        />
      </FormField>
    </>
  );
}
