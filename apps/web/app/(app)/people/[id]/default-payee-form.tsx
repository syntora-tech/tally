'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { saveDefaultPayee, type PayeeFormState } from '@/server/actions/payees';

type Props = {
  personId: string;
  currentPayeeId: string | null;
  options: { value: string; label: string }[];
};

export function DefaultPayeeForm({ personId, currentPayeeId, options }: Props) {
  const [state, action, pending] = useActionState<PayeeFormState, FormData>(saveDefaultPayee, null);

  useEffect(() => {
    if (state?.ok) toast.success('Одержувача збережено');
    else if (state) toast.error(state.error.message);
  }, [state]);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="personId" value={personId} />
      <NativeSelect
        name="payeeId"
        aria-label="Одержувач виплат за замовчуванням"
        defaultValue={currentPayeeId ?? ''}
        placeholder="Не вибрано"
        options={options}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Зберегти
      </Button>
      <Button
        size="sm"
        variant="ghost"
        render={<Link href={`/people/payees/new?personId=${personId}`} />}
      >
        Новий одержувач
      </Button>
    </form>
  );
}
