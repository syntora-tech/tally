import { addMonths, startOfMonth, type LocalDate } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { listPeriods } from '@/server/services/periods';
import { OpenPeriodForm } from './open-period-form';
import { getFormat, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('periods');

export default async function PeriodsPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const periods = (await listPeriods.run(ctx, {})).unwrapOr([]);
  const latest = periods[0]?.period.month as LocalDate | undefined;
  const suggested = (latest ? addMonths(latest, 1) : startOfMonth(ctx.today)).slice(0, 7);
  const t = await getTranslations('periods');
  const fmt = await getFormat();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('open')}</CardTitle>
        </CardHeader>
        <CardContent>
          <OpenPeriodForm suggestedMonth={suggested} />
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('col.month')}</TableHead>
            <TableHead>{t('col.status')}</TableHead>
            <TableHead>{t('col.norm')}</TableHead>
            <TableHead>{t('col.fx')}</TableHead>
            <TableHead>{t('col.hoursRows')}</TableHead>
            <TableHead>{t('col.invoices')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                {t('empty')}
              </TableCell>
            </TableRow>
          )}
          {periods.map(({ period: p, hoursRows, invoices }) => (
            <TableRow key={p.id}>
              <TableCell>
                <Link className="font-medium hover:underline" href={`/periods/${p.id}`}>
                  {fmt.month(p.month)}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={p.status === 'open' ? 'default' : 'secondary'}>
                  {p.status === 'open' ? t('statusOpen') : t('statusClosed')}
                </Badge>
              </TableCell>
              <TableCell>{fmt.amount(p.workHours)}</TableCell>
              <TableCell>
                {p.referenceFxUsdUah ? fmt.amount(p.referenceFxUsdUah, undefined, { dp: 4 }) : '—'}
              </TableCell>
              <TableCell>{hoursRows}</TableCell>
              <TableCell>{invoices}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
