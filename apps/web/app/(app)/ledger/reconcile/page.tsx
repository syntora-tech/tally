import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FormField, NativeSelect } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listAccounts, reconcileAccount } from '@/server/services/ledger';
import { toDecimal } from '@tally/domain';
import { getFormat, localizeForUser, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('reconcile');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** A balance pasted from a statement: `2,896.78` (comma grouping) or `2 896,78` (decimal comma). */
const pastedAmount = (raw: string) => {
  const compact = raw.replace(/\s/g, '');
  return compact.includes('.') ? compact.replaceAll(',', '') : compact.replace(',', '.');
};

/** Reconciliation (6.7): a GET form, so a result can be bookmarked or shared; nothing is stored. */
export default async function ReconcilePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const params = await searchParams;
  const query = {
    accountId: first(params.accountId),
    onDate: first(params.onDate) || ctx.today,
    statementBalance: pastedAmount(first(params.statementBalance)),
  };
  const [accounts, t, fmt] = await Promise.all([
    listAccounts.run(ctx, {}),
    getTranslations('reconcile'),
    getFormat(),
  ]);
  const result =
    query.accountId && query.statementBalance ? await reconcileAccount.run(ctx, query) : null;
  const error = result?.isErr() ? await localizeForUser(result.error) : null;
  const value = result?.isOk() ? result.value : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <FormField label={t('account')} htmlFor="r-account" error={error?.fieldErrors?.accountId}>
          <NativeSelect
            id="r-account"
            name="accountId"
            defaultValue={query.accountId}
            placeholder={t('chooseAccount')}
            options={accounts
              .unwrapOr([])
              .map(({ account: a }) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
          />
        </FormField>
        <FormField label={t('onDate')} htmlFor="r-date" error={error?.fieldErrors?.onDate}>
          <Input id="r-date" name="onDate" type="date" defaultValue={query.onDate} />
        </FormField>
        <FormField
          label={t('statementBalance')}
          htmlFor="r-balance"
          error={error?.fieldErrors?.statementBalance}
        >
          <Input
            id="r-balance"
            name="statementBalance"
            inputMode="decimal"
            defaultValue={query.statementBalance}
            className="w-40"
          />
        </FormField>
        <Button type="submit">{t('check')}</Button>
      </form>
      {error && !error.fieldErrors && <p className="text-destructive">{error.message}</p>}
      {value && (
        <Card className="max-w-xl" data-testid="reconcile-result">
          <CardHeader>
            <CardTitle className="text-base">
              {t('resultTitle', { account: value.account.name, date: fmt.date(query.onDate) })}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('statement')}</span>
              <span className="tabular-nums">
                {fmt.amount(query.statementBalance, value.account.currency)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t('computed')}</span>
              <span className="tabular-nums">
                {fmt.amount(value.computed, value.account.currency)}
              </span>
            </div>
            <div className="flex justify-between gap-4 font-medium">
              <span>{t('difference')}</span>
              <span className="tabular-nums" data-testid="reconcile-difference">
                {fmt.amount(value.difference, value.account.currency)}
              </span>
            </div>
            <p
              className={
                toDecimal(value.difference).isZero() ? 'text-muted-foreground' : 'text-destructive'
              }
            >
              {toDecimal(value.difference).isZero() ? t('matches') : t('mismatch')}
            </p>
            <Link
              href={`/ledger?accountId=${value.account.id}&to=${query.onDate}`}
              className="underline"
            >
              {t('openJournal')}
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
