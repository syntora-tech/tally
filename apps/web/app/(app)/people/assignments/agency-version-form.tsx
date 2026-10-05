'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toOptions, useLabels } from '@/lib/labels';
import { addAgencyVersionAction, type AssignmentFormState } from '@/server/actions/assignments';

export type AgencyDefaults = {
  payeeId: string;
  ratePerHour: string;
  payoutMethod: string;
  releasePolicy: string;
  graceDays: number;
};

/** New agency fee version (A-068); rate 0 from a month ends the fee. */
export function AgencyVersionForm({
  assignmentId,
  suggestedMonth,
  payees,
  defaults,
}: {
  assignmentId: string;
  suggestedMonth: string;
  payees: { value: string; label: string }[];
  defaults: AgencyDefaults | null;
}) {
  const [state, action, pending] = useActionState<AssignmentFormState, FormData>(
    addAgencyVersionAction,
    null,
  );
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('terms');
  const tc = useTranslations('common');
  const { PAYOUT_METHOD_LABELS, RELEASE_POLICY_LABELS } = useLabels();

  useEffect(() => {
    if (state?.ok) toast.success(t('versionSaved'));
  }, [state, t]);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {state && !state.ok && !errors && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <FormField label={t('validFrom')} htmlFor="agency-validFrom" error={errors?.validFrom}>
          <Input
            id="agency-validFrom"
            name="validFrom"
            type="month"
            required
            defaultValue={suggestedMonth}
            className="w-44"
          />
        </FormField>
        <FormField label={t('agencyPayee')} htmlFor="agency-payee" error={errors?.payeeId}>
          <NativeSelect
            id="agency-payee"
            name="payeeId"
            defaultValue={defaults?.payeeId ?? ''}
            placeholder={t('chooseAgency')}
            options={payees}
          />
        </FormField>
        <FormField label={t('ratePerHour')} htmlFor="agency-rate" error={errors?.ratePerHour}>
          <Input
            id="agency-rate"
            name="ratePerHour"
            inputMode="decimal"
            defaultValue={defaults?.ratePerHour ?? ''}
            className="w-28"
          />
        </FormField>
        <FormField label={t('payoutMethod')} htmlFor="agency-method">
          <NativeSelect
            id="agency-method"
            name="payoutMethod"
            defaultValue={defaults?.payoutMethod ?? 'fiat'}
            options={toOptions(PAYOUT_METHOD_LABELS)}
          />
        </FormField>
        <FormField label={t('releasePolicy')} htmlFor="agency-release">
          <NativeSelect
            id="agency-release"
            name="releasePolicy"
            defaultValue={defaults?.releasePolicy ?? 'on_payment_or_due'}
            options={toOptions(RELEASE_POLICY_LABELS)}
          />
        </FormField>
        <FormField label={t('graceDays')} htmlFor="agency-grace" error={errors?.graceDays}>
          <Input
            id="agency-grace"
            name="graceDays"
            type="number"
            min={0}
            defaultValue={defaults?.graceDays ?? 0}
            className="w-20"
          />
        </FormField>
      </div>
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? tc('saving') : t('addVersion')}
      </Button>
    </form>
  );
}
