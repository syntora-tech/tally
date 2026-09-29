import { addMonths, formatAmount, startOfMonth, type LocalDate } from '@tally/domain';
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
import { monthTitle } from '@/lib/months';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listPeriods } from '@/server/services/periods';
import { OpenPeriodForm } from './open-period-form';

export const metadata: Metadata = { title: 'Періоди · Tally' };

export default async function PeriodsPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const periods = (await listPeriods.run(ctx, {})).unwrapOr([]);
  const latest = periods[0]?.period.month as LocalDate | undefined;
  const suggested = (latest ? addMonths(latest, 1) : startOfMonth(ctx.today)).slice(0, 7);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Періоди</h1>
        <p className="text-muted-foreground">
          Місячне закриття: години, розрахунок, чернетки інвойсів
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Відкрити період</CardTitle>
        </CardHeader>
        <CardContent>
          <OpenPeriodForm suggestedMonth={suggested} />
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Місяць</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Норма, год</TableHead>
            <TableHead>Курс USD</TableHead>
            <TableHead>Рядків годин</TableHead>
            <TableHead>Інвойсів</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {periods.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                Періодів ще немає
              </TableCell>
            </TableRow>
          )}
          {periods.map(({ period: p, hoursRows, invoices }) => (
            <TableRow key={p.id}>
              <TableCell>
                <Link className="font-medium hover:underline" href={`/periods/${p.id}`}>
                  {monthTitle(p.month)}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={p.status === 'open' ? 'default' : 'secondary'}>
                  {p.status === 'open' ? 'Відкритий' : 'Закритий'}
                </Badge>
              </TableCell>
              <TableCell>{formatAmount(p.workHours)}</TableCell>
              <TableCell>
                {p.referenceFxUsdUah
                  ? formatAmount(p.referenceFxUsdUah, undefined, { dp: 4 })
                  : '—'}
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
