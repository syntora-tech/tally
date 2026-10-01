import { formatAmount, formatUaDate, toDecimal, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
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
import { TX_TYPE_LABELS, toOptions } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import {
  impliedRate,
  listAccounts,
  listCategories,
  listTransactions,
} from '@/server/services/ledger';
import { DeleteTransactionButton } from './ledger-forms';

export const metadata: Metadata = { title: 'Ledger · Tally' };

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ledger</h1>
          <p className="text-muted-foreground">Рахунки, транзакції та розподіл оплат</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href="/ledger/accounts" />}>
            Рахунки
          </Button>
          <Button variant="outline" render={<Link href="/ledger/categories" />}>
            Категорії
          </Button>
          <Button render={<Link href="/ledger/new" />}>Нова транзакція</Button>
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
                {formatAmount(balance, a.currency, { dp: a.kind === 'crypto' ? 6 : 2 })}
              </span>
            </CardContent>
          </Card>
        ))}
        {accountRows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Рахунків ще немає —{' '}
            <Link href="/ledger/accounts" className="underline">
              додайте
            </Link>
          </p>
        )}
      </div>

      <form
        method="get"
        className="grid grid-cols-2 items-end gap-3 rounded-md border p-4 md:grid-cols-7"
        aria-label="Фільтри"
      >
        <FormField label="З" htmlFor="f-from">
          <Input id="f-from" name="from" type="date" defaultValue={filters.from} />
        </FormField>
        <FormField label="По" htmlFor="f-to">
          <Input id="f-to" name="to" type="date" defaultValue={filters.to} />
        </FormField>
        <FormField label="Тип" htmlFor="f-type">
          <NativeSelect
            id="f-type"
            name="type"
            defaultValue={filters.type}
            placeholder="Усі"
            options={toOptions(TX_TYPE_LABELS)}
          />
        </FormField>
        <FormField label="Категорія" htmlFor="f-category">
          <NativeSelect
            id="f-category"
            name="categoryId"
            defaultValue={filters.categoryId}
            placeholder="Усі"
            options={categories.unwrapOr([]).map((c) => ({
              value: c.id,
              label: `${c.name} (${TX_TYPE_LABELS[c.txType] ?? c.txType})`,
            }))}
          />
        </FormField>
        <FormField label="Рахунок" htmlFor="f-account">
          <NativeSelect
            id="f-account"
            name="accountId"
            defaultValue={filters.accountId}
            placeholder="Усі"
            options={accountRows.map(({ account: a }) => ({ value: a.id, label: a.name }))}
          />
        </FormField>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="unallocated" defaultChecked={filters.unallocated === 'on'} />
          Нерозподілені
        </label>
        <Button type="submit" variant="outline">
          Показати
        </Button>
      </form>

      {journal.isErr() ? (
        <p className="text-destructive">{journal.error.message}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Дата</TableHead>
                <TableHead>Тип / категорія</TableHead>
                <TableHead>Проводки</TableHead>
                <TableHead>Опис</TableHead>
                <TableHead>Розподілено</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {journal.value.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                    Транзакцій не знайдено
                  </TableCell>
                </TableRow>
              )}
              {journal.value.map((t) => {
                const rate = impliedRate(t.postings);
                const settles =
                  t.transaction.type === 'revenue' || t.transaction.type === 'expense';
                const open =
                  settles &&
                  t.mainAmount !== null &&
                  toDecimal(t.allocated).lt(toDecimal(t.mainAmount));
                return (
                  <TableRow key={t.transaction.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatUaDate(t.transaction.occurredOn as LocalDate)}
                    </TableCell>
                    <TableCell>
                      {TX_TYPE_LABELS[t.transaction.type]}
                      <div className="text-muted-foreground">{t.categoryName}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {t.postings.map((p) => (
                        <div key={p.id} className={p.isFee ? 'text-muted-foreground' : undefined}>
                          {formatAmount(p.amount, p.currency, {
                            dp: toDecimal(p.amount).decimalPlaces() > 2 ? 6 : 2,
                          })}{' '}
                          · {p.accountName}
                          {p.isFee ? ' (комісія)' : ''}
                        </div>
                      ))}
                      {rate && t.transaction.type !== 'transfer' && (
                        <div className="text-xs text-muted-foreground">курс {rate.toFixed(6)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.transaction.counterparty && (
                        <div className="font-medium">{t.transaction.counterparty}</div>
                      )}
                      {t.transaction.description}
                    </TableCell>
                    <TableCell>
                      {settles ? (
                        open ? (
                          <Badge variant="outline">
                            {formatAmount(t.allocated)} з {formatAmount(t.mainAmount ?? '0')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">повністю</Badge>
                        )
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {toDecimal(t.allocated).isZero() && (
                        <DeleteTransactionButton id={t.transaction.id} />
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
