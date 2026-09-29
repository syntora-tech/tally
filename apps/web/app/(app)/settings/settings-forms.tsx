'use client';

import { Trash2 } from 'lucide-react';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deleteCalendarExceptionAction,
  saveCalendarExceptionAction,
  saveSequenceAction,
  type SettingsFormState,
} from '@/server/actions/settings';

function useFeedback(state: SettingsFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
    else if (state && !state.error.fieldErrors) toast.error(state.error.message);
  }, [state, success]);
  return state && !state.ok ? state.error.fieldErrors : undefined;
}

export function CalendarExceptionForm() {
  const [state, action, pending] = useActionState(saveCalendarExceptionAction, null);
  const errors = useFeedback(state, 'Виняток збережено');
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <FormField label="Дата" htmlFor="onDate" error={errors?.onDate}>
        <Input id="onDate" name="onDate" type="date" required className="w-44" />
      </FormField>
      <FormField label="Причина" htmlFor="exception-reason" error={errors?.reason}>
        <Input
          id="exception-reason"
          name="reason"
          required
          placeholder="День Незалежності"
          className="w-72"
        />
      </FormField>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="isWorking" /> Робочий день (перенесена субота)
      </label>
      <Button type="submit" disabled={pending}>
        Додати
      </Button>
    </form>
  );
}

export function DeleteExceptionButton({ onDate }: { onDate: string }) {
  const [state, action, pending] = useActionState(deleteCalendarExceptionAction, null);
  useFeedback(state, 'Виняток видалено');
  return (
    <form action={action}>
      <input type="hidden" name="onDate" value={onDate} />
      <Button type="submit" size="icon" variant="ghost" disabled={pending} aria-label="Видалити">
        <Trash2 className="size-4" />
      </Button>
    </form>
  );
}

export type SequenceValues = {
  key: string;
  template: string;
  nextValue: number;
  yearScoped: boolean;
};

/** New sequence, or an existing one (key fixed); the counter can only go up. */
export function SequenceForm({ sequence }: { sequence?: SequenceValues }) {
  const [state, action, pending] = useActionState(saveSequenceAction, null);
  const errors = useFeedback(state, 'Нумерацію збережено');
  const idp = sequence ? `seq-${sequence.key}` : 'seq-new';
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {sequence ? (
        <input type="hidden" name="key" value={sequence.key} />
      ) : (
        <FormField label="Ключ" htmlFor={`${idp}-key`} error={errors?.key}>
          <Input id={`${idp}-key`} name="key" required placeholder="act:OD-1004" className="w-44" />
        </FormField>
      )}
      <FormField label="Шаблон" htmlFor={`${idp}-template`} error={errors?.template}>
        <Input
          id={`${idp}-template`}
          name="template"
          required
          defaultValue={sequence?.template ?? '{seq}/{yy}'}
          className="w-44"
        />
      </FormField>
      <FormField label="Наступний №" htmlFor={`${idp}-next`} error={errors?.nextValue}>
        <Input
          id={`${idp}-next`}
          name="nextValue"
          type="number"
          min={sequence?.nextValue ?? 1}
          defaultValue={sequence?.nextValue ?? 1}
          className="w-28"
        />
      </FormField>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input type="checkbox" name="yearScoped" defaultChecked={sequence?.yearScoped ?? false} />
        Скидати щороку
      </label>
      <Button type="submit" variant={sequence ? 'outline' : 'default'} disabled={pending}>
        {sequence ? 'Зберегти' : 'Додати'}
      </Button>
    </form>
  );
}
