'use client';

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
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {state && !state.ok && !errors && (
        <Alert variant="destructive" role="alert" className="w-full">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label="Місяць" htmlFor="month" error={errors?.month}>
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
        label="Норма, год"
        htmlFor="workHours"
        hint="Порожньо — робочі дні × 8"
        error={errors?.workHours}
      >
        <Input id="workHours" name="workHours" inputMode="decimal" className="w-32" />
      </FormField>
      <FormField
        label="Довідковий курс USD→UAH"
        htmlFor="referenceFxUsdUah"
        error={errors?.referenceFxUsdUah}
      >
        <Input
          id="referenceFxUsdUah"
          name="referenceFxUsdUah"
          inputMode="decimal"
          className="w-40"
        />
      </FormField>
      <Button type="submit" disabled={pending}>
        {pending ? 'Відкриваємо…' : 'Відкрити період'}
      </Button>
    </form>
  );
}
