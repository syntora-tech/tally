import { formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
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
import { FX_SOURCE_LABELS } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listRates, suggestRate } from '@/server/services/fx';
import { ManualRateForm } from '../ledger-forms';

export const metadata: Metadata = { title: 'Курси · Tally' };

export default async function RatesPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const [rates, suggestion] = await Promise.all([
    listRates.run(ctx, {}),
    suggestRate.run(ctx, { onDate: ctx.today, fetchMissing: false }),
  ]);
  const today = suggestion.unwrapOr(null);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">Курси валют</h1>
        <p className="text-muted-foreground">
          Для виплат: фактичний обмін за 3 дні → НБУ на дату → останній ручний
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Курс виплати на сьогодні:{' '}
            {today ? (
              <>
                {today.rate} <Badge variant="outline">{FX_SOURCE_LABELS[today.source]}</Badge>
              </>
            ) : (
              'немає даних'
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
            <TableHead>Дата</TableHead>
            <TableHead>Валюта</TableHead>
            <TableHead>Курс, UAH</TableHead>
            <TableHead>Джерело</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.unwrapOr([]).map((r) => (
            <TableRow key={r.id}>
              <TableCell>{formatUaDate(r.onDate as LocalDate)}</TableCell>
              <TableCell>{r.base}</TableCell>
              <TableCell className="tabular-nums">{r.rate}</TableCell>
              <TableCell>{FX_SOURCE_LABELS[r.source]}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
