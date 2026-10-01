'use client';

import { derivedRate, parseDecimal } from '@tally/domain';
import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toOptions, useLabels } from '@/lib/labels';
import { createTransactionAction, type LedgerFormState } from '@/server/actions/ledger';

type AccountOption = { id: string; name: string; currency: string };
type CategoryOption = { id: string; txType: string; name: string };

const TWO_LEG = ['transfer', 'fx_exchange', 'crypto_buy', 'crypto_sell', 'crypto_swap'];

export function TransactionForm(props: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState<LedgerFormState, FormData>(
    createTransactionAction,
    null,
  );
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('txForm');
  const tc = useTranslations('common');
  const { TX_TYPE_LABELS } = useLabels();
  const [type, setType] = useState('expense');
  const [legs, setLegs] = useState({ from: '', to: '', fromAmount: '', toAmount: '' });
  const [adjustSign, setAdjustSign] = useState<'to' | 'from'>('to');

  const accountOptions = props.accounts.map((a) => ({
    value: a.id,
    label: `${a.name} (${a.currency})`,
  }));
  const currencyOf = (id: string) => props.accounts.find((a) => a.id === id)?.currency ?? '';
  const twoLeg = TWO_LEG.includes(type);
  const showFrom = type === 'expense' || twoLeg || (type === 'adjustment' && adjustSign === 'from');
  const showTo = type === 'revenue' || twoLeg || (type === 'adjustment' && adjustSign === 'to');
  const out = parseDecimal(legs.fromAmount);
  const into = parseDecimal(legs.toAmount);
  const rate =
    twoLeg &&
    out.isOk() &&
    into.isOk() &&
    !out.value.isZero() &&
    currencyOf(legs.from) !== currencyOf(legs.to)
      ? derivedRate(out.value, into.value).toFixed(6)
      : null;

  const leg = (key: 'from' | 'to', label: string) => (
    <div className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-2">
      <FormField label={label} htmlFor={`${key}-account`} error={errors?.[key]}>
        <NativeSelect
          id={`${key}-account`}
          name={`${key}.accountId`}
          placeholder={t('chooseAccount')}
          options={accountOptions}
          value={legs[key]}
          onChange={(e) => {
            setLegs({ ...legs, [key]: e.target.value });
          }}
        />
      </FormField>
      <FormField
        label={
          currencyOf(legs[key]) ? t('amountIn', { currency: currencyOf(legs[key]) }) : t('amount')
        }
        htmlFor={`${key}-amount`}
      >
        <Input
          id={`${key}-amount`}
          name={`${key}.amount`}
          inputMode="decimal"
          value={key === 'from' ? legs.fromAmount : legs.toAmount}
          onChange={(e) => {
            const value = e.target.value.replace(',', '.');
            setLegs({ ...legs, [key === 'from' ? 'fromAmount' : 'toAmount']: value });
          }}
        />
      </FormField>
    </div>
  );

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-4">
      {state && !state.ok && !state.error.fieldErrors && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <FormField label={t('type')} htmlFor="type">
          <NativeSelect
            id="type"
            name="type"
            value={type}
            options={toOptions(TX_TYPE_LABELS)}
            onChange={(e) => {
              setType(e.target.value);
            }}
          />
        </FormField>
        <FormField label={t('date')} htmlFor="occurredOn" error={errors?.occurredOn}>
          <Input
            id="occurredOn"
            name="occurredOn"
            type="date"
            defaultValue={props.today}
            required
          />
        </FormField>
        <FormField label={t('category')} htmlFor="categoryId" error={errors?.categoryId}>
          <NativeSelect
            id="categoryId"
            name="categoryId"
            key={type}
            placeholder={t('chooseCategory')}
            options={props.categories
              .filter((c) => c.txType === type)
              .map((c) => ({ value: c.id, label: c.name }))}
            defaultValue={
              props.categories.filter((c) => c.txType === type).length === 1
                ? props.categories.find((c) => c.txType === type)?.id
                : ''
            }
          />
        </FormField>
      </div>

      {type === 'adjustment' && (
        <FormField label={t('direction')} htmlFor="adjust-sign">
          <NativeSelect
            id="adjust-sign"
            value={adjustSign}
            options={[
              { value: 'to', label: t('increase') },
              { value: 'from', label: t('decrease') },
            ]}
            onChange={(e) => {
              setAdjustSign(e.target.value === 'from' ? 'from' : 'to');
            }}
          />
        </FormField>
      )}
      {showFrom && leg('from', twoLeg ? t('fromAccount') : t('account'))}
      {showTo && leg('to', twoLeg ? t('toAccount') : t('account'))}
      {rate && (
        <p className="text-sm text-muted-foreground">
          {t('derivedRate', { from: currencyOf(legs.from), rate, to: currencyOf(legs.to) })}
        </p>
      )}

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm">{t('fee')}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label={t('feeAccount')} htmlFor="fee-account" error={errors?.fee}>
            <NativeSelect
              id="fee-account"
              name="fee.accountId"
              placeholder={t('noFee')}
              options={accountOptions}
            />
          </FormField>
          <FormField label={t('feeAmount')} htmlFor="fee-amount">
            <Input id="fee-amount" name="fee.amount" inputMode="decimal" />
          </FormField>
        </div>
      </details>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label={t('counterparty')} htmlFor="counterparty">
          <Input id="counterparty" name="counterparty" />
        </FormField>
        <FormField
          label={type.startsWith('crypto') ? t('txHash') : t('bankRef')}
          htmlFor="externalRef"
        >
          <Input id="externalRef" name="externalRef" />
        </FormField>
      </div>
      <FormField label={t('description')} htmlFor="description">
        <Textarea id="description" name="description" rows={2} />
      </FormField>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : t('submit')}
        </Button>
      </div>
    </form>
  );
}
