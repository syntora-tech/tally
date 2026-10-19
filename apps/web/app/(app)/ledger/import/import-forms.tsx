'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { prepareBankImportAction, prepareCryptoImportAction } from '@/server/actions/ledger-import';

export function BankStatementForm({ accounts }: { accounts: { id: string; label: string }[] }) {
  const t = useTranslations('ledgerImport');
  const [state, action, pending] = useActionState(prepareBankImportAction, null);
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="bank-import-form">
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label={t('files')}
          htmlFor="import-files"
          error={error?.fieldErrors?.files}
          hint={t('filesHint')}
        >
          <Input
            id="import-files"
            name="files"
            type="file"
            multiple
            required
            accept=".csv,.xlsx,text/csv"
            className="w-96 max-w-full"
          />
        </FormField>
        <FormField
          label={t('account')}
          htmlFor="import-account"
          error={error?.fieldErrors?.accountId}
        >
          <NativeSelect
            id="import-account"
            name="accountId"
            defaultValue=""
            placeholder={t('detectAccount')}
            options={accounts.map((a) => ({ value: a.id, label: a.label }))}
          />
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending ? t('reading') : t('read')}
        </Button>
      </div>
      {error && !error.fieldErrors && <p className="text-sm text-destructive">{error.message}</p>}
    </form>
  );
}

export function CryptoFetchForm() {
  const t = useTranslations('ledgerImport');
  const [state, action, pending] = useActionState(prepareCryptoImportAction, null);
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="crypto-import-form">
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label={t('since')}
          htmlFor="crypto-from"
          error={error?.fieldErrors?.from}
          hint={t('sinceHint')}
        >
          <Input id="crypto-from" name="from" type="date" className="w-44" />
        </FormField>
        <Button type="submit" disabled={pending}>
          {pending ? t('fetching') : t('fetchCrypto')}
        </Button>
      </div>
      {error && !error.fieldErrors && <p className="text-sm text-destructive">{error.message}</p>}
    </form>
  );
}
