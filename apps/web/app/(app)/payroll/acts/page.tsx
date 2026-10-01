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
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listActs } from '@/server/services/acts';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('acts');

const ACT_TYPES = ['monthly', 'reimbursement', 'other'] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ActsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const params = await searchParams;
  const filters = { payeeId: first(params.payeeId), year: first(params.year) };
  const result = await listActs.run(ctx, filters);
  const data = result.unwrapOr({ acts: [], summary: [] });
  const allPayees = (await listActs.run(ctx, {})).unwrapOr({ acts: [], summary: [] }).summary;
  const [t, fmt, { DOC_STATUS_LABELS }] = await Promise.all([
    getTranslations('acts'),
    getFormat(),
    getLabels(),
  ]);
  const actType = (type: string) =>
    (ACT_TYPES as readonly string[]).includes(type)
      ? t(`type.${type as (typeof ACT_TYPES)[number]}`)
      : type;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
            {t('back')}
          </Link>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
        </div>
        <Button render={<Link href="/payroll/acts/new" />}>{t('newAct')}</Button>
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
            options={allPayees.map((p) => ({ value: p.payeeId, label: p.payeeName }))}
          />
        </FormField>
        <FormField label={t('year')} htmlFor="f-year">
          <Input
            id="f-year"
            name="year"
            inputMode="numeric"
            defaultValue={filters.year}
            className="w-24"
          />
        </FormField>
        <Button type="submit" variant="outline">
          {t('show')}
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {data.summary.map((s) => (
          <Card key={s.payeeId}>
            <CardContent className="flex flex-col gap-1 pt-6 text-sm">
              <span className="font-medium">{s.payeeName}</span>
              <span>{t('issuedFor', { amount: fmt.amount(s.total, 'UAH') })}</span>
              {s.missing.length > 0 && (
                <span className="text-destructive" data-testid="missing-periods">
                  {t('missing', { months: s.missing.map((m) => fmt.month(`${m}-01`)).join(', ') })}
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.number')}</TableHead>
            <TableHead>{t('col.date')}</TableHead>
            <TableHead>{t('col.counterparty')}</TableHead>
            <TableHead>{t('col.period')}</TableHead>
            <TableHead>{t('col.amount')}</TableHead>
            <TableHead>{t('col.status')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.acts.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                {t('empty')}
              </TableCell>
            </TableRow>
          )}
          {data.acts.map(({ act: a, payeeName, contractNumber }) => (
            <TableRow key={a.id}>
              <TableCell>
                <Link href={`/payroll/acts/${a.id}`} className="font-medium hover:underline">
                  {a.number ?? t('draft')}
                </Link>
                {a.isLegacy && (
                  <Badge variant="outline" className="ml-2">
                    {t('legacy')}
                  </Badge>
                )}
              </TableCell>
              <TableCell>{fmt.date(a.actDate)}</TableCell>
              <TableCell>
                {payeeName}
                <div className="text-muted-foreground">{contractNumber}</div>
              </TableCell>
              <TableCell>
                {actType(a.type)}
                {a.periodFrom && a.periodTo && (
                  <div className="text-muted-foreground">
                    {fmt.date(a.periodFrom)}–{fmt.date(a.periodTo)}
                  </div>
                )}
              </TableCell>
              <TableCell className="tabular-nums">{fmt.amount(a.amountUah, 'UAH')}</TableCell>
              <TableCell>
                <Badge variant={a.status === 'draft' ? 'outline' : 'secondary'}>
                  {DOC_STATUS_LABELS[a.status] ?? a.status}
                </Badge>
                {a.signedUrl && (
                  <Badge variant="outline" className="ml-1">
                    {t('signed')}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
