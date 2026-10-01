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
import { listRates, suggestRate } from '@/server/services/fx';
import { ManualRateForm } from '../ledger-forms';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('rates');

export default async function RatesPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const [rates, suggestion] = await Promise.all([
    listRates.run(ctx, {}),
    suggestRate.run(ctx, { onDate: ctx.today, fetchMissing: false }),
  ]);
  const today = suggestion.unwrapOr(null);
  const t = await getTranslations('rates');
  const fmt = await getFormat();
  const { FX_SOURCE_LABELS } = await getLabels();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('todayRate')}{' '}
            {today ? (
              <>
                {today.rate} <Badge variant="outline">{FX_SOURCE_LABELS[today.source]}</Badge>
              </>
            ) : (
              t('noData')
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ManualRateForm today={ctx.today} />
        </CardContent>
      </Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('date')}</TableHead>
            <TableHead>{t('pair')}</TableHead>
            <TableHead>{t('rate')}</TableHead>
            <TableHead>{t('source')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.unwrapOr([]).map((r) => (
            <TableRow key={r.id}>
              <TableCell>{fmt.date(r.onDate)}</TableCell>
              <TableCell>
                {r.base}/{r.quote}
              </TableCell>
              <TableCell className="tabular-nums">{r.rate}</TableCell>
              <TableCell>{FX_SOURCE_LABELS[r.source]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
