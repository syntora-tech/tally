'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('defaultPayee');
  const tc = useTranslations('common');

  useEffect(() => {
    if (state?.ok) toast.success(t('saved'));
    else if (state) toast.error(state.error.message);
  }, [state, t]);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="personId" value={personId} />
      <NativeSelect
        name="payeeId"
        aria-label={t('label')}
        defaultValue={currentPayeeId ?? ''}
        placeholder={t('none')}
        options={options}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {tc('save')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        render={<Link href={`/people/payees/new?personId=${personId}`} />}
      >
        {t('new')}
      </Button>
    </form>
  );
}
