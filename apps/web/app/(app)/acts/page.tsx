import { Download } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Fragment } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FINANCE_ROLES } from '@/lib/navigation';
import { getFormat, getLabels, localizeForUser, pageTitle } from '@/server/i18n';
import { requireRole } from '@/server/request-context';
import { actsRegistry } from '@/server/services/acts/registry';

export const generateMetadata = pageTitle('acts');

const ACT_TYPES = ['monthly', 'reimbursement', 'other'] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Supplier acts registry (A-087): the accountant's sheet — acts by counterparty with subtotals. */
export default async function ActsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const params = await searchParams;
  const filters = {
    payeeId: first(params.payeeId) ?? '',
    // The current year unless the form asked for another one, or for all years with an empty field.
    year: first(params.year) ?? ctx.today.slice(0, 4),
    all: first(params.all) === 'on',
  };
  const result = await actsRegistry.run(ctx, filters);
  const [t, fmt, { DOC_STATUS_LABELS }] = await Promise.all([
    getTranslations('acts'),
    getFormat(),
    getLabels(),
  ]);
  if (result.isErr()) {
    return <p className="text-destructive">{(await localizeForUser(result.error)).message}</p>;
  }
  const { groups, total, count, payees } = result.value;
  const exportQuery = new URLSearchParams({ payeeId: filters.payeeId, year: filters.year });
  const actType = (type: string) =>
    (ACT_TYPES as readonly string[]).includes(type)
      ? t(`type.${type as (typeof ACT_TYPES)[number]}`)
      : type;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            render={<a href={`/api/acts/registry?${exportQuery.toString()}`} />}
          >
            <Download className="size-4" /> {t('export')}
          </Button>
          <Button render={<Link href="/acts/new" />}>{t('newAct')}</Button>
        </div>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border p-4"
        aria-label={t('filters')}
      >
        <FormField label={t('counterparty')} htmlFor="f-payee">
          <NativeSelect
            id="f-payee"
            name="payeeId"
            defaultValue={filters.payeeId}
            placeholder={t('all')}
            options={payees.map((p) => ({ value: p.payeeId, label: p.payeeName }))}
          />
        </FormField>
        <FormField label={t('year')} htmlFor="f-year" hint={t('yearHint')}>
          <Input
            id="f-year"
            name="year"
            inputMode="numeric"
            defaultValue={filters.year}
            className="w-24"
          />
        </FormField>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="all" defaultChecked={filters.all} /> {t('withDrafts')}
        </label>
        <Button type="submit" variant="outline">
          {t('show')}
        </Button>
      </form>

      <Table data-testid="acts-registry">
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.counterparty')}</TableHead>
            <TableHead>{t('col.date')}</TableHead>
            <TableHead>{t('col.number')}</TableHead>
            <TableHead className="text-right">{t('col.amount')}</TableHead>
            <TableHead>{t('col.period')}</TableHead>
            <TableHead>{t('col.contract')}</TableHead>
            <TableHead>{t('col.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="h-16 text-center text-muted-foreground">
                {t('empty')}
              </TableCell>
            </TableRow>
          )}
          {groups.map((g) => (
            <Fragment key={g.payeeId}>
              {g.acts.map((a) => {
                const counted = a.status === 'issued';
                return (
                  <TableRow key={a.id} className={counted ? undefined : 'text-muted-foreground'}>
                    <TableCell>
                      <Link href={`/people/payees/${g.payeeId}`} className="hover:underline">
                        {g.payeeName}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{fmt.date(a.actDate)}</TableCell>
                    <TableCell>
                      <Link href={`/acts/${a.id}`} className="font-medium hover:underline">
                        {a.number ?? t('draft')}
                      </Link>
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${a.status === 'void' ? 'line-through' : ''}`}
                    >
                      {fmt.amount(a.amountUah, 'UAH')}
                    </TableCell>
                    <TableCell>
                      {actType(a.type)}
                      {a.periodFrom && a.periodTo && (
                        <div className="text-muted-foreground">
                          {fmt.date(a.periodFrom)}–{fmt.date(a.periodTo)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{a.contractNumber}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {!counted && (
                          <Badge variant="outline">{DOC_STATUS_LABELS[a.status] ?? a.status}</Badge>
                        )}
                        {a.isLegacy && <Badge variant="outline">{t('legacy')}</Badge>}
                        {a.signed && <Badge variant="secondary">{t('signed')}</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/40 font-medium" data-testid="acts-subtotal">
                <TableCell colSpan={3}>
                  {t('subtotal', { payee: g.payeeName })}
                  {g.missing.length > 0 && (
                    <div className="font-normal text-destructive" data-testid="missing-periods">
                      {t('missing', {
                        months: g.missing.map((m) => fmt.month(`${m}-01`)).join(', '),
                      })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt.amount(g.total, 'UAH')}
                </TableCell>
                <TableCell colSpan={3} />
              </TableRow>
            </Fragment>
          ))}
        </TableBody>
        {groups.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>{t('total', { count })}</TableCell>
              <TableCell className="text-right tabular-nums" data-testid="acts-total">
                {fmt.amount(total, 'UAH')}
              </TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  );
}
