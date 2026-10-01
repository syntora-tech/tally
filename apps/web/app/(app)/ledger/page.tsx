import { toDecimal } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FormField, NativeSelect } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toOptions } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import {
  impliedRate,
  listAccounts,
  listCategories,
  listTransactions,
} from '@/server/services/ledger';
import { DeleteTransactionButton } from './ledger-forms';
import { getFormat, getLabels, localizeForUser, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('ledger');

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const params = await searchParams;
  const filters = {
    from: first(params.from),
    to: first(params.to),
    type: first(params.type),
    categoryId: first(params.categoryId),
    accountId: first(params.accountId),
    unallocated: first(params.unallocated),
  };
  const [accounts, categories, journal] = await Promise.all([
    listAccounts.run(ctx, {}),
    listCategories.run(ctx, {}),
    listTransactions.run(ctx, filters),
  ]);
  const accountRows = accounts.unwrapOr([]);
  const [t, fmt, { TX_TYPE_LABELS }] = await Promise.all([
    getTranslations('ledger'),
    getFormat(),
    getLabels(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ledger</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href="/ledger/accounts" />}>
            {t('accounts')}
          </Button>
          <Button variant="outline" render={<Link href="/ledger/categories" />}>
            {t('categories')}
          </Button>
          <Button variant="outline" render={<Link href="/ledger/rates" />}>
            {t('rates')}
          </Button>
          <Button render={<Link href="/ledger/new" />}>{t('newTransaction')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accountRows.map(({ account: a, balance }) => (
          <Card key={a.id}>
            <CardContent className="flex flex-col gap-1 pt-6">
              <Link
                href={`/ledger?accountId=${a.id}`}
                className="text-sm text-muted-foreground hover:underline"
              >
                {a.name}
                {a.network ? ` · ${a.network}` : ''}
              </Link>
              <span className="text-xl font-semibold tabular-nums">
                {fmt.amount(balance, a.currency, { dp: a.kind === 'crypto' ? 6 : 2 })}
              </span>
            </CardContent>
          </Card>
        ))}
        {accountRows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t('noAccounts')}{' '}
            <Link href="/ledger/accounts" className="underline">
              {t('addThem')}
            </Link>
          </p>
        )}
      </div>

      <form
        method="get"
        className="grid grid-cols-2 items-end gap-3 rounded-md border p-4 md:grid-cols-7"
        aria-label={t('filters')}
      >
        <FormField label={t('from')} htmlFor="f-from">
          <Input id="f-from" name="from" type="date" defaultValue={filters.from} />
        </FormField>
        <FormField label={t('to')} htmlFor="f-to">
          <Input id="f-to" name="to" type="date" defaultValue={filters.to} />
        </FormField>
        <FormField label={t('type')} htmlFor="f-type">
          <NativeSelect
            id="f-type"
            name="type"
            defaultValue={filters.type}
            placeholder={t('all')}
            options={toOptions(TX_TYPE_LABELS)}
          />
        </FormField>
        <FormField label={t('category')} htmlFor="f-category">
          <NativeSelect
            id="f-category"
            name="categoryId"
            defaultValue={filters.categoryId}
            placeholder={t('all')}
            options={categories.unwrapOr([]).map((c) => ({
              value: c.id,
              label: `${c.name} (${TX_TYPE_LABELS[c.txType] ?? c.txType})`,
            }))}
          />
        </FormField>
        <FormField label={t('account')} htmlFor="f-account">
          <NativeSelect
            id="f-account"
            name="accountId"
            defaultValue={filters.accountId}
            placeholder={t('all')}
            options={accountRows.map(({ account: a }) => ({ value: a.id, label: a.name }))}
          />
        </FormField>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="unallocated" defaultChecked={filters.unallocated === 'on'} />
          {t('unallocated')}
        </label>
        <Button type="submit" variant="outline">
          {t('show')}
        </Button>
      </form>

      {journal.isErr() ? (
        <p className="text-destructive">{(await localizeForUser(journal.error)).message}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col.date')}</TableHead>
                <TableHead>{t('col.typeCategory')}</TableHead>
                <TableHead>{t('col.postings')}</TableHead>
                <TableHead>{t('col.description')}</TableHead>
                <TableHead>{t('col.allocated')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {journal.value.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                    {t('noTransactions')}
                  </TableCell>
                </TableRow>
              )}
              {journal.value.map((tx) => {
                const rate = impliedRate(tx.postings);
                const settles =
                  tx.transaction.type === 'revenue' || tx.transaction.type === 'expense';
                const open =
                  settles &&
                  tx.mainAmount !== null &&
                  toDecimal(tx.allocated).lt(toDecimal(tx.mainAmount));
                return (
                  <TableRow key={tx.transaction.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmt.date(tx.transaction.occurredOn)}
                    </TableCell>
                    <TableCell>
                      {TX_TYPE_LABELS[tx.transaction.type]}
                      <div className="text-muted-foreground">{tx.categoryName}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {tx.postings.map((p) => (
                        <div key={p.id} className={p.isFee ? 'text-muted-foreground' : undefined}>
                          {fmt.amount(p.amount, p.currency, {
                            dp: toDecimal(p.amount).decimalPlaces() > 2 ? 6 : 2,
                          })}{' '}
                          · {p.accountName}
                          {p.isFee ? t('fee') : ''}
                        </div>
                      ))}
                      {rate && tx.transaction.type !== 'transfer' && (
                        <div className="text-xs text-muted-foreground">
                          {t('rate', { rate: rate.toFixed(6) })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {tx.transaction.counterparty && (
                        <div className="font-medium">{tx.transaction.counterparty}</div>
                      )}
                      {tx.transaction.description}
                    </TableCell>
                    <TableCell>
                      {settles ? (
                        open ? (
                          <Badge variant="outline">
                            {t('allocatedOf', {
                              allocated: fmt.amount(tx.allocated),
                              total: fmt.amount(tx.mainAmount ?? '0'),
                            })}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t('fully')}</Badge>
                        )
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {toDecimal(tx.allocated).isZero() && (
                        <DeleteTransactionButton id={tx.transaction.id} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
