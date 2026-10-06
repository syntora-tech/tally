'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addTermsVersion,
  updateTermsVersion,
  type AssignmentFormState,
} from '@/server/actions/assignments';
import { BillingFields, PayFields, type BillingDefaults, type PayDefaults } from './terms-fields';

type Common = {
  assignmentId: string;
  suggestedMonth: string;
  /** Set when an existing version is corrected in place (A-077). */
  versionId?: string;
  onSaved?: () => void;
};

type Props =
  | (Common & { side: 'billing'; defaults: BillingDefaults })
  | (Common & { side: 'pay'; defaults: PayDefaults });

/**
 * New terms version from a month, or a correction of an existing one; closed periods are rejected
 * by I10 with a readable message.
 */
export function AddVersionForm(props: Props) {
  const editing = props.versionId !== undefined;
  const [state, action, pending] = useActionState<AssignmentFormState, FormData>(
    editing ? updateTermsVersion : addTermsVersion,
    null,
  );
  const { onSaved } = props;
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('terms');
  const tc = useTranslations('common');

  useEffect(() => {
    if (!state?.ok) return;
    toast.success(editing ? t('versionUpdated') : t('versionSaved'));
    onSaved?.();
  }, [state, t, editing, onSaved]);

  const idBase = editing ? `${props.side}-${props.versionId ?? ''}-` : undefined;

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-3 rounded-md border p-3">
      <input type="hidden" name="side" value={props.side} />
      {editing ? (
        <input type="hidden" name="id" value={props.versionId} />
      ) : (
        <input type="hidden" name="assignmentId" value={props.assignmentId} />
      )}
      {state && !state.ok && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField
        label={t('validFrom')}
        htmlFor={`${idBase ?? `${props.side}-`}validFrom`}
        error={errors?.validFrom}
      >
        <Input
          id={`${idBase ?? `${props.side}-`}validFrom`}
          name="validFrom"
          type="month"
          required
          defaultValue={props.suggestedMonth}
          className="w-44"
        />
      </FormField>
      {props.side === 'billing' ? (
        <BillingFields prefix="" idBase={idBase} defaults={props.defaults} errors={errors} />
      ) : (
        <PayFields prefix="" idBase={idBase} defaults={props.defaults} errors={errors} />
      )}
      <Button type="submit" size="sm" disabled={pending} className="self-start">
        {pending ? tc('saving') : editing ? tc('save') : t('addVersion')}
      </Button>
    </form>
  );
}
