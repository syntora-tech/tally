'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { editableDecimal } from '@/lib/format';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toOptions, useLabels } from '@/lib/labels';
import { savePerson, type PersonFormState } from '@/server/actions/people';

export type PersonFormValues = {
  id?: string;
  fullName: string;
  displayName: string | null;
  position: string | null;
  seniority: string[];
  stack: string[];
  domains: string[];
  marketRateUsd: string | null;
  allocation: string | null;
  availabilityFrom: string | null;
  location: string | null;
  timezone: string | null;
  contactOwner: string | null;
  status: string;
  notes: string | null;
};

export function PersonForm({ person }: { person?: PersonFormValues }) {
  const [state, action, pending] = useActionState<PersonFormState, FormData>(savePerson, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const cancelHref = person?.id ? `/people/${person.id}` : '/people';
  const t = useTranslations('personForm');
  const tc = useTranslations('common');
  const { ALLOCATION_LABELS, PERSON_STATUS_LABELS } = useLabels();

  return (
    <form action={action} className="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2">
      {person?.id && <input type="hidden" name="id" value={person.id} />}
      {state && !state.ok && (
        <Alert variant="destructive" className="md:col-span-2" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label={t('fullName')} htmlFor="fullName" error={errors?.fullName}>
        <Input id="fullName" name="fullName" defaultValue={person?.fullName} required />
      </FormField>
      <FormField label={t('displayName')} htmlFor="displayName" error={errors?.displayName}>
        <Input id="displayName" name="displayName" defaultValue={person?.displayName ?? ''} />
      </FormField>
      <FormField label={t('position')} htmlFor="position" error={errors?.position}>
        <Input
          id="position"
          name="position"
          defaultValue={person?.position ?? ''}
          placeholder="DevOps Engineer"
        />
      </FormField>
      <FormField label={t('seniority')} htmlFor="seniority" hint={t('seniorityHint')}>
        <Input id="seniority" name="seniority" defaultValue={person?.seniority.join(', ')} />
      </FormField>
      <FormField label={t('stack')} htmlFor="stack" hint={t('stackHint')} className="md:col-span-2">
        <Input id="stack" name="stack" defaultValue={person?.stack.join(', ')} />
      </FormField>
      <FormField
        label={t('domains')}
        htmlFor="domains"
        hint={t('domainsHint')}
        className="md:col-span-2"
      >
        <Input id="domains" name="domains" defaultValue={person?.domains.join(', ')} />
      </FormField>
      <FormField label={t('marketRate')} htmlFor="marketRateUsd" error={errors?.marketRateUsd}>
        <Input
          id="marketRateUsd"
          name="marketRateUsd"
          inputMode="decimal"
          defaultValue={editableDecimal(person?.marketRateUsd ?? null)}
        />
      </FormField>
      <FormField label={t('allocation')} htmlFor="allocation" error={errors?.allocation}>
        <NativeSelect
          id="allocation"
          name="allocation"
          defaultValue={person?.allocation ?? ''}
          placeholder={t('notSet')}
          options={toOptions(ALLOCATION_LABELS)}
        />
      </FormField>
      <FormField
        label={t('availableFrom')}
        htmlFor="availabilityFrom"
        hint={t('availableFromHint')}
        error={errors?.availabilityFrom}
      >
        <Input
          id="availabilityFrom"
          name="availabilityFrom"
          type="date"
          defaultValue={person?.availabilityFrom ?? ''}
        />
      </FormField>
      <FormField label={t('status')} htmlFor="status" error={errors?.status}>
        <NativeSelect
          id="status"
          name="status"
          defaultValue={person?.status ?? 'active'}
          options={toOptions(PERSON_STATUS_LABELS)}
        />
      </FormField>
      <FormField label={t('location')} htmlFor="location">
        <Input
          id="location"
          name="location"
          defaultValue={person?.location ?? ''}
          placeholder="Ukraine"
        />
      </FormField>
      <FormField label={t('timezone')} htmlFor="timezone">
        <Input
          id="timezone"
          name="timezone"
          defaultValue={person?.timezone ?? ''}
          placeholder="UTC+3"
        />
      </FormField>
      <FormField label={t('contactOwner')} htmlFor="contactOwner">
        <Input
          id="contactOwner"
          name="contactOwner"
          defaultValue={person?.contactOwner ?? ''}
          placeholder="@alina_syntora"
        />
      </FormField>
      <FormField label={t('notes')} htmlFor="notes" className="md:col-span-2">
        <Textarea id="notes" name="notes" defaultValue={person?.notes ?? ''} rows={3} />
      </FormField>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : tc('save')}
        </Button>
        <Button variant="ghost" render={<Link href={cancelHref} />}>
          {tc('cancel')}
        </Button>
      </div>
    </form>
  );
}
