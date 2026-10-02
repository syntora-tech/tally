'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { NetworkSelect } from '@/components/network-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  addWalletAction,
  updateWalletAction,
  type WalletFormState,
} from '@/server/actions/wallets';

export type WalletOwnerField = { name: 'personId' | 'clientId'; value: string };

function useFeedback(state: WalletFormState, success: string, onSuccess?: () => void) {
  useEffect(() => {
    if (state?.ok) {
      toast.success(success);
      onSuccess?.();
    } else if (state && !state.error.fieldErrors) toast.error(state.error.message);
  }, [state, success, onSuccess]);
  return state && !state.ok ? state.error.fieldErrors : undefined;
}

export function AddWalletForm({ owner }: { owner: WalletOwnerField }) {
  const [state, action, pending] = useActionState(addWalletAction, null);
  const t = useTranslations('wallets');
  const tc = useTranslations('common');
  const form = useRef<HTMLFormElement>(null);
  const errors = useFeedback(state, t('added'), () => form.current?.reset());
  const p = `wallet-${owner.value}`;
  return (
    <form ref={form} action={action} className="grid grid-cols-1 items-end gap-3 md:grid-cols-6">
      <input type="hidden" name={owner.name} value={owner.value} />
      <FormField label={t('network')} htmlFor={`${p}-network`} error={errors?.network}>
        <NetworkSelect id={`${p}-network`} name="network" defaultValue="ETH" />
      </FormField>
      <FormField
        label={t('address')}
        htmlFor={`${p}-address`}
        error={errors?.address}
        className="md:col-span-3"
      >
        <Input id={`${p}-address`} name="address" required autoComplete="off" spellCheck={false} />
      </FormField>
      <FormField label={t('label')} htmlFor={`${p}-label`} error={errors?.label}>
        <Input id={`${p}-label`} name="label" placeholder={t('labelHint')} />
      </FormField>
      <Button type="submit" disabled={pending}>
        {tc('add')}
      </Button>
    </form>
  );
}

/** Deactivating keeps the wallet for identifying old Ledger transactions (A-060). */
export function WalletActiveToggle({
  id,
  label,
  isActive,
}: {
  id: string;
  label: string | null;
  isActive: boolean;
}) {
  const [state, action, pending] = useActionState(updateWalletAction, null);
  const t = useTranslations('wallets');
  useFeedback(state, isActive ? t('activated') : t('deactivated'));
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="label" value={label ?? ''} />
      {!isActive && <input type="hidden" name="isActive" value="on" />}
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {isActive ? t('deactivate') : t('activate')}
      </Button>
    </form>
  );
}
