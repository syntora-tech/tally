'use client';

import { derivedRate, parseDecimal } from '@tally/domain';
import { useActionState, useState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { TX_TYPE_LABELS, toOptions } from '@/lib/labels';
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
          placeholder="Оберіть рахунок"
          options={accountOptions}
          value={legs[key]}
          onChange={(e) => {
            setLegs({ ...legs, [key]: e.target.value });
          }}
        />
      </FormField>
      <FormField
        label={`Сума${currencyOf(legs[key]) ? `, ${currencyOf(legs[key])}` : ''}`}
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
        <FormField label="Тип" htmlFor="type">
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
        <FormField label="Дата" htmlFor="occurredOn" error={errors?.occurredOn}>
          <Input
            id="occurredOn"
            name="occurredOn"
            type="date"
            defaultValue={props.today}
            required
          />
        </FormField>
        <FormField label="Категорія" htmlFor="categoryId" error={errors?.categoryId}>
          <NativeSelect
            id="categoryId"
            name="categoryId"
            key={type}
            placeholder="Оберіть категорію"
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
        <FormField label="Напрям" htmlFor="adjust-sign">
          <NativeSelect
            id="adjust-sign"
            value={adjustSign}
            options={[
              { value: 'to', label: 'Збільшити залишок' },
              { value: 'from', label: 'Зменшити залишок' },
            ]}
            onChange={(e) => {
              setAdjustSign(e.target.value === 'from' ? 'from' : 'to');
            }}
          />
        </FormField>
      )}
      {showFrom && leg('from', twoLeg ? 'Списати з рахунку' : 'Рахунок')}
      {showTo && leg('to', twoLeg ? 'Зарахувати на рахунок' : 'Рахунок')}
      {rate && (
        <p className="text-sm text-muted-foreground">
          Курс з двох сум: 1 {currencyOf(legs.from)} = {rate} {currencyOf(legs.to)}
        </p>
      )}

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm">Комісія (необов’язково)</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <FormField label="Рахунок комісії" htmlFor="fee-account" error={errors?.fee}>
            <NativeSelect
              id="fee-account"
              name="fee.accountId"
              placeholder="Без комісії"
              options={accountOptions}
            />
          </FormField>
          <FormField label="Сума комісії" htmlFor="fee-amount">
            <Input id="fee-amount" name="fee.amount" inputMode="decimal" />
          </FormField>
        </div>
      </details>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Контрагент" htmlFor="counterparty">
          <Input id="counterparty" name="counterparty" />
        </FormField>
        <FormField
          label={type.startsWith('crypto') ? 'Хеш транзакції' : 'Референс банку / хеш'}
          htmlFor="externalRef"
        >
          <Input id="externalRef" name="externalRef" />
        </FormField>
      </div>
      <FormField label="Опис" htmlFor="description">
        <Textarea id="description" name="description" rows={2} />
      </FormField>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти транзакцію'}
        </Button>
      </div>
    </form>
  );
}
