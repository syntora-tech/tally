'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addTermsVersion, type AssignmentFormState } from '@/server/actions/assignments';
import { BillingFields, PayFields, type BillingDefaults, type PayDefaults } from './terms-fields';

type Props =
  | { side: 'billing'; assignmentId: string; defaults: BillingDefaults; suggestedMonth: string }
  | { side: 'pay'; assignmentId: string; defaults: PayDefaults; suggestedMonth: string };

/** New terms version from a month; closed periods are rejected by I10 with a readable message. */
export function AddVersionForm(props: Props) {
  const [state, action, pending] = useActionState<AssignmentFormState, FormData>(
    addTermsVersion,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('terms');
  const tc = useTranslations('common');

  useEffect(() => {
    if (state?.ok) toast.success(t('versionSaved'));
  }, [state, t]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="side" value={props.side} />
      <input type="hidden" name="assignmentId" value={props.assignmentId} />
      {state && !state.ok && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField
        label={t('validFrom')}
        htmlFor={`${props.side}-validFrom`}
        error={errors?.validFrom}
      >
        <Input
          id={`${props.side}-validFrom`}
          name="validFrom"
          type="month"
          required
          defaultValue={props.suggestedMonth}
          className="w-44"
        />
      </FormField>
      {props.side === 'billing' ? (
        <BillingFields prefix="" defaults={props.defaults} errors={errors} />
      ) : (
        <PayFields prefix="" defaults={props.defaults} errors={errors} />
      )}
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? tc('saving') : t('addVersion')}
      </Button>
    </form>
  );
}
