'use client';

import { derivedRate, parseDecimal, toDecimal } from '@tally/domain';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { cn } from 'cn';
import { useIsV2 } from '@/components/v2/ui-version';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { editableDecimal } from '@/lib/format';
import { toOptions, useLabels } from '@/lib/labels';
import {
  createTransactionAction,
  updateTransactionAction,
  type LedgerFormState,
} from '@/server/actions/ledger';

type AccountOption = { id: string; name: string; currency: string; kind: string };
type CategoryOption = { id: string; txType: string; name: string };
type PartyOption = { id: string; name: string };

/** A stored transaction as the form edits it. */
export type TransactionValues = {
  id: string;
  type: string;
  occurredOn: string;
  categoryId: string;
  description: string | null;
  counterparty: string | null;
  externalRef: string | null;
  personId: string | null;
  clientId: string | null;
  counterpartyAddress: string | null;
  postings: { accountId: string; amount: string; isFee: boolean }[];
  /** Money already allocated: changing amounts then needs a reason. */
  allocated: boolean;
};

function legsOf(value?: TransactionValues) {
  const legs = value?.postings.filter((p) => !p.isFee) ?? [];
  const out = legs.find((p) => toDecimal(p.amount).isNeg());
  const into = legs.find((p) => !toDecimal(p.amount).isNeg());
  const abs = (v?: string) => (v ? editableDecimal(toDecimal(v).abs().toFixed(8)) : '');
  return {
    from: out?.accountId ?? '',
    to: into?.accountId ?? '',
    fromAmount: abs(out?.amount),
    toAmount: abs(into?.amount),
  };
}

const TWO_LEG = ['transfer', 'fx_exchange', 'crypto_buy', 'crypto_sell', 'crypto_swap'];
/** v2: the everyday types as a switch, the rest under "More". */
const MAIN_TYPES = ['expense', 'revenue', 'transfer', 'fx_exchange'];

export function TransactionForm(props: {
  accounts: AccountOption[];
  categories: CategoryOption[];
  people: PartyOption[];
  clients: PartyOption[];
  today: string;
  value?: TransactionValues;
}) {
  const { value } = props;
  const [state, action, pending] = useActionState<LedgerFormState, FormData>(
    value ? updateTransactionAction : createTransactionAction,
    null,
  );
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const t = useTranslations('txForm');
  const tc = useTranslations('common');
  const { TX_TYPE_LABELS } = useLabels();
  const v2 = useIsV2();
  const [type, setType] = useState(value?.type ?? 'expense');
  const [legs, setLegs] = useState(() => legsOf(value));
  const [adjustSign, setAdjustSign] = useState<'to' | 'from'>(
    value?.type === 'adjustment' && legsOf(value).from ? 'from' : 'to',
  );
  const [party, setParty] = useState(
    value?.personId
      ? `person:${value.personId}`
      : value?.clientId
        ? `client:${value.clientId}`
        : '',
  );
  const fee = value?.postings.find((p) => p.isFee);
  const [feeOpen, setFeeOpen] = useState(Boolean(fee));
  const [refOpen, setRefOpen] = useState(Boolean(value?.externalRef));
  const isCrypto = [legs.from, legs.to].some(
    (id) => props.accounts.find((a) => a.id === id)?.kind === 'crypto',
  );

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
    <div
      className={cn(
        'grid grid-cols-1 gap-3 md:grid-cols-2',
        v2 ? 'items-end' : 'rounded-md border p-3',
      )}
    >
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
          placeholder={v2 ? '0.00' : undefined}
          className={v2 ? 'font-heading text-lg font-bold tabular-nums' : undefined}
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
      {value && <input type="hidden" name="id" value={value.id} />}
      {v2 && (
        <div className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="type" value={type} />
          <div
            role="radiogroup"
            aria-label={t('type')}
            className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1"
          >
            {MAIN_TYPES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={type === k}
                onClick={() => {
                  setType(k);
                }}
                className={cn(
                  'h-8 rounded-md px-3 text-[13px] font-medium',
                  type === k
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {TX_TYPE_LABELS[k]}
              </button>
            ))}
          </div>
          <select
            aria-label={t('moreTypes')}
            value={MAIN_TYPES.includes(type) ? '' : type}
            onChange={(e) => {
              if (e.target.value) setType(e.target.value);
            }}
            className={cn(
              'h-10 rounded-lg border bg-card px-3 text-[13px] font-medium',
              !MAIN_TYPES.includes(type) && 'border-foreground',
            )}
          >
            <option value="">{t('moreTypes')}</option>
            {Object.entries(TX_TYPE_LABELS)
              .filter(([k]) => !MAIN_TYPES.includes(k))
              .map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
          </select>
        </div>
      )}
      <div className={cn('grid grid-cols-1 gap-3', v2 ? 'md:grid-cols-2' : 'md:grid-cols-3')}>
        {!v2 && (
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
        )}
        <FormField label={t('date')} htmlFor="occurredOn" error={errors?.occurredOn}>
          <Input
            id="occurredOn"
            name="occurredOn"
            type="date"
            defaultValue={value?.occurredOn ?? props.today}
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
              value?.type === type
                ? value.categoryId
                : props.categories.filter((c) => c.txType === type).length === 1
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

      {v2 ? (
        feeOpen ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label={t('feeAccount')} htmlFor="fee-account" error={errors?.fee}>
              <NativeSelect
                id="fee-account"
                name="fee.accountId"
                placeholder={t('noFee')}
                options={accountOptions}
                defaultValue={fee?.accountId ?? (legs.from || legs.to)}
              />
            </FormField>
            <FormField label={t('feeAmount')} htmlFor="fee-amount">
              <Input
                id="fee-amount"
                name="fee.amount"
                inputMode="decimal"
                defaultValue={fee ? editableDecimal(toDecimal(fee.amount).abs().toFixed(8)) : ''}
              />
            </FormField>
          </div>
        ) : (
          <button
            type="button"
            className="self-start text-sm font-medium text-link hover:underline"
            onClick={() => {
              setFeeOpen(true);
            }}
          >
            + {t('v2.addFee')}
          </button>
        )
      ) : (
        <details className="rounded-md border p-3" open={Boolean(fee)}>
          <summary className="cursor-pointer text-sm">{t('fee')}</summary>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label={t('feeAccount')} htmlFor="fee-account" error={errors?.fee}>
              <NativeSelect
                id="fee-account"
                name="fee.accountId"
                placeholder={t('noFee')}
                options={accountOptions}
                defaultValue={fee?.accountId ?? ''}
              />
            </FormField>
            <FormField label={t('feeAmount')} htmlFor="fee-amount">
              <Input
                id="fee-amount"
                name="fee.amount"
                inputMode="decimal"
                defaultValue={fee ? editableDecimal(toDecimal(fee.amount).abs().toFixed(8)) : ''}
              />
            </FormField>
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label={t('party')} htmlFor="party" error={errors?.personId ?? errors?.clientId}>
          <NativeSelect
            id="party"
            value={party}
            placeholder={t('noParty')}
            options={[
              ...props.people.map((p) => ({ value: `person:${p.id}`, label: p.name })),
              ...props.clients.map((c) => ({
                value: `client:${c.id}`,
                label: `${c.name} · ${t('client')}`,
              })),
            ]}
            onChange={(e) => {
              setParty(e.target.value);
            }}
          />
          <input
            type="hidden"
            name="personId"
            value={party.startsWith('person:') ? party.slice(7) : ''}
          />
          <input
            type="hidden"
            name="clientId"
            value={party.startsWith('client:') ? party.slice(7) : ''}
          />
        </FormField>
        <FormField label={t('counterparty')} htmlFor="counterparty">
          <Input id="counterparty" name="counterparty" defaultValue={value?.counterparty ?? ''} />
        </FormField>
        {(isCrypto || value?.counterpartyAddress) && (
          <FormField
            label={t('counterpartyAddress')}
            htmlFor="counterpartyAddress"
            error={errors?.counterpartyAddress}
            hint={t('counterpartyAddressHint')}
          >
            <Input
              id="counterpartyAddress"
              name="counterpartyAddress"
              defaultValue={value?.counterpartyAddress ?? ''}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
        )}
        {v2 && !refOpen ? (
          <button
            type="button"
            className="self-end justify-self-start pb-2.5 text-sm font-medium text-link hover:underline"
            onClick={() => {
              setRefOpen(true);
            }}
          >
            + {t('v2.addRef')}
          </button>
        ) : (
          <FormField
            label={isCrypto || type.startsWith('crypto') ? t('txHash') : t('bankRef')}
            htmlFor="externalRef"
          >
            <Input id="externalRef" name="externalRef" defaultValue={value?.externalRef ?? ''} />
          </FormField>
        )}
      </div>
      <FormField label={t('description')} htmlFor="description">
        <Textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={value?.description ?? ''}
        />
      </FormField>
      {value?.allocated && (
        <FormField
          label={t('reason')}
          htmlFor="reason"
          error={errors?.reason}
          hint={t('reasonHint')}
        >
          <Input id="reason" name="reason" />
        </FormField>
      )}
      <div className={v2 ? 'flex gap-2' : undefined}>
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : value ? tc('save') : t('submit')}
        </Button>
        {v2 && (
          <Button variant="outline" render={<Link href="/ledger" />}>
            {tc('cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
