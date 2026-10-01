import { formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
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
import { DOC_STATUS_LABELS } from '@/lib/labels';
import { monthTitle } from '@/lib/months';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listActs } from '@/server/services/acts';

export const metadata: Metadata = { title: 'Акти ФОП · Tally' };

const ACT_TYPE: Record<string, string> = {
  monthly: 'місячний',
  reimbursement: 'компенсація',
  other: 'інше',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ActsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const params = await searchParams;
  const filters = { payeeId: first(params.payeeId), year: first(params.year) };
  const result = await listActs.run(ctx, filters);
  const data = result.unwrapOr({ acts: [], summary: [] });
  const allPayees = (await listActs.run(ctx, {})).unwrapOr({ acts: [], summary: [] }).summary;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
            ← Виплати
          </Link>
          <h1 className="text-2xl font-semibold">Реєстр актів ФОП</h1>
        </div>
        <Button render={<Link href="/payroll/acts/new" />}>Позачерговий акт</Button>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-md border p-4"
        aria-label="Фільтри"
      >
        <FormField label="Контрагент" htmlFor="f-payee">
          <NativeSelect
            id="f-payee"
            name="payeeId"
            defaultValue={filters.payeeId}
            placeholder="Усі"
            options={allPayees.map((p) => ({ value: p.payeeId, label: p.payeeName }))}
          />
        </FormField>
        <FormField label="Рік" htmlFor="f-year">
          <Input
            id="f-year"
            name="year"
            inputMode="numeric"
            defaultValue={filters.year}
            className="w-24"
          />
        </FormField>
        <Button type="submit" variant="outline">
          Показати
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {data.summary.map((s) => (
          <Card key={s.payeeId}>
            <CardContent className="flex flex-col gap-1 pt-6 text-sm">
              <span className="font-medium">{s.payeeName}</span>
              <span>Випущено на {formatAmount(s.total, 'UAH')}</span>
              {s.missing.length > 0 && (
                <span className="text-destructive" data-testid="missing-periods">
                  Немає акту за: {s.missing.map((m) => monthTitle(`${m}-01`)).join(', ')}
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Номер</TableHead>
            <TableHead>Дата</TableHead>
            <TableHead>Контрагент</TableHead>
            <TableHead>Період</TableHead>
            <TableHead>Сума</TableHead>
            <TableHead>Статус</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.acts.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                Актів не знайдено
              </TableCell>
            </TableRow>
          )}
          {data.acts.map(({ act: a, payeeName, contractNumber }) => (
            <TableRow key={a.id}>
              <TableCell>
                <Link href={`/payroll/acts/${a.id}`} className="font-medium hover:underline">
                  {a.number ?? 'чернетка'}
                </Link>
                {a.isLegacy && (
                  <Badge variant="outline" className="ml-2">
                    архів
                  </Badge>
                )}
              </TableCell>
              <TableCell>{formatUaDate(a.actDate as LocalDate)}</TableCell>
              <TableCell>
                {payeeName}
                <div className="text-muted-foreground">{contractNumber}</div>
              </TableCell>
              <TableCell>
                {ACT_TYPE[a.type]}
                {a.periodFrom && a.periodTo && (
                  <div className="text-muted-foreground">
                    {formatUaDate(a.periodFrom as LocalDate)}–
                    {formatUaDate(a.periodTo as LocalDate)}
                  </div>
                )}
              </TableCell>
              <TableCell className="tabular-nums">{formatAmount(a.amountUah, 'UAH')}</TableCell>
              <TableCell>
                <Badge variant={a.status === 'draft' ? 'outline' : 'secondary'}>
                  {DOC_STATUS_LABELS[a.status] ?? a.status}
                </Badge>
                {a.signedUrl && (
                  <Badge variant="outline" className="ml-1">
                    підписано
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
