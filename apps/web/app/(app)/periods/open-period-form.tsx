'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { openPeriodAction, type PeriodFormState } from '@/server/actions/periods';

export function OpenPeriodForm({ suggestedMonth }: { suggestedMonth: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    openPeriodAction,
    null,
  );
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('periods.form');
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {state && !state.ok && !errors && (
        <Alert variant="destructive" role="alert" className="w-full">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label={t('month')} htmlFor="month" error={errors?.month}>
        <Input
          id="month"
          name="month"
          type="month"
          required
          defaultValue={suggestedMonth}
          className="w-44"
        />
      </FormField>
      <FormField
        label={t('norm')}
        htmlFor="workHours"
        hint={t('normHint')}
        error={errors?.workHours}
      >
        <Input id="workHours" name="workHours" inputMode="decimal" className="w-32" />
      </FormField>
      <FormField label={t('fx')} htmlFor="referenceFxUsdUah" error={errors?.referenceFxUsdUah}>
        <Input
          id="referenceFxUsdUah"
          name="referenceFxUsdUah"
          inputMode="decimal"
          className="w-40"
        />
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? t('opening') : t('open')}
      </Button>
    </form>
  );
}
