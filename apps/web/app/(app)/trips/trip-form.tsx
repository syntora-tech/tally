'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveTripAction, type TripFormState } from '@/server/actions/trips';

export type TripValues = {
  id: string;
  title: string;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  notes: string | null;
  participantIds: string[];
};

export function TripForm({
  value,
  people,
}: {
  value?: TripValues;
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState<TripFormState, FormData>(saveTripAction, null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('trips');
  const tc = useTranslations('common');
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      {value && <input type="hidden" name="id" value={value.id} />}
      {state && !state.ok && !errors && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <FormField label={t('form.title')} htmlFor="trip-title" error={errors?.title}>
        <Input id="trip-title" name="title" defaultValue={value?.title} required />
      </FormField>
      <FormField label={t('form.location')} htmlFor="trip-location">
        <Input id="trip-location" name="location" defaultValue={value?.location ?? ''} />
      </FormField>
      <div className="flex flex-wrap gap-4">
        <FormField label={t('form.startsOn')} htmlFor="trip-from" error={errors?.startsOn}>
          <Input id="trip-from" name="startsOn" type="date" defaultValue={value?.startsOn ?? ''} />
        </FormField>
        <FormField label={t('form.endsOn')} htmlFor="trip-to" error={errors?.endsOn}>
          <Input id="trip-to" name="endsOn" type="date" defaultValue={value?.endsOn ?? ''} />
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('form.participants')}</legend>
        <div className="grid max-h-64 grid-cols-1 gap-1 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="participantIds"
                value={p.id}
                defaultChecked={value?.participantIds.includes(p.id)}
              />
              {p.name}
            </label>
          ))}
        </div>
        {errors?.participantIds && (
          <p className="text-sm text-destructive">{errors.participantIds.join(' ')}</p>
        )}
      </fieldset>
      <FormField label={t('form.notes')} htmlFor="trip-notes">
        <Input id="trip-notes" name="notes" defaultValue={value?.notes ?? ''} />
      </FormField>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? tc('saving') : tc('save')}
      </Button>
    </form>
  );
}
