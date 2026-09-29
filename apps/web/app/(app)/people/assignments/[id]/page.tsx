import { addMonths, formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BILLING_TYPE_LABELS,
  PAY_TYPE_LABELS,
  PAYOUT_METHOD_LABELS,
  PRORATION_LABELS,
  RELEASE_POLICY_LABELS,
} from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getAssignment } from '@/server/services/assignments';
import { AddVersionForm } from '../add-version-form';

export const metadata: Metadata = { title: 'Залучення · Tally' };

const monthLabel = new Intl.DateTimeFormat('uk-UA', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const month = (d: string) => monthLabel.format(new Date(`${d}T00:00:00Z`));

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getAssignment.run(ctx, { id });
  if (result.isErr()) notFound();
  const {
    assignment: a,
    personName,
    clientName,
    clientId,
    contractNumber,
    billing,
    pay,
    margin,
  } = result.value;
  const nextMonth = addMonths(ctx.today, 1).slice(0, 7);
  const [lastBilling] = billing;
  const [lastPay] = pay;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            <Link href={`/people/${a.personId}`} className="hover:underline">
              {personName}
            </Link>
            {' · '}
            {a.isInternal ? (
              'Внутрішнє'
            ) : (
              <Link href={`/clients/${clientId ?? ''}`} className="hover:underline">
                {clientName}
              </Link>
            )}
          </h1>
          <p className="text-muted-foreground">
            {[a.roleTitle, a.sowRef, contractNumber].filter(Boolean).join(' · ')} · FTE {a.fte} ·{' '}
            {formatUaDate(a.startsOn as LocalDate)} —{' '}
            {a.endsOn ? formatUaDate(a.endsOn as LocalDate) : 'без дати завершення'}
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/people/assignments/${a.id}/edit`} />}>
          Редагувати
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Маржа за умовами</CardTitle>
          <CardDescription>
            Орієнтовно: білінг і ЗП за повний місяць (
            {margin ? `${month(margin.month)}, норма ${margin.workHours} год` : 'поточний місяць'}).
            Фактична маржа — з годинами на Етапі 2.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {margin ? (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Клієнту</div>
                <div className="text-lg font-medium">
                  {formatAmount(margin.billing, margin.currency)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Людині</div>
                <div className="text-lg font-medium">
                  {formatAmount(margin.pay, margin.currency)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Маржа</div>
                <div className="text-lg font-semibold" data-testid="assignment-margin">
                  {formatAmount(margin.margin, margin.currency)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Недостатньо даних або різні валюти білінгу й ЗП.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Клієнту — версії умов</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>З місяця</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Ставка</TableHead>
                  <TableHead>Деталі</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{month(b.validFrom)}</TableCell>
                    <TableCell>{BILLING_TYPE_LABELS[b.type]}</TableCell>
                    <TableCell>
                      {b.type === 'none' ? '—' : formatAmount(b.rate, b.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.type === 'fixed_monthly' ? PRORATION_LABELS[b.prorationPolicy] : ''}{' '}
                      <Badge variant="outline">{PAYOUT_METHOD_LABELS[b.invoiceChannel]}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <AddVersionForm
              side="billing"
              assignmentId={a.id}
              suggestedMonth={nextMonth}
              defaults={{
                type: lastBilling?.type ?? 'hourly',
                rate: lastBilling?.rate ?? '',
                currency: lastBilling?.currency ?? 'USD',
                prorationPolicy: lastBilling?.prorationPolicy ?? 'full_month',
                invoiceChannel: lastBilling?.invoiceChannel ?? 'fiat',
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Людині — версії умов</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>З місяця</TableHead>
                  <TableHead>Тип</TableHead>
                  <TableHead>Сума</TableHead>
                  <TableHead>Деталі</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pay.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{month(p.validFrom)}</TableCell>
                    <TableCell>{PAY_TYPE_LABELS[p.type]}</TableCell>
                    <TableCell>
                      {p.type === 'included' ? '—' : formatAmount(p.amount, p.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PAYOUT_METHOD_LABELS[p.payoutMethod]} ·{' '}
                      {RELEASE_POLICY_LABELS[p.releasePolicy]}
                      {p.graceDays > 0 ? ` · +${p.graceDays} р.д.` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <AddVersionForm
              side="pay"
              assignmentId={a.id}
              suggestedMonth={nextMonth}
              defaults={{
                type: lastPay?.type ?? 'fixed',
                amount: lastPay?.amount ?? '',
                currency: lastPay?.currency ?? 'USD',
                payoutMethod: lastPay?.payoutMethod ?? 'fiat',
                releasePolicy: lastPay?.releasePolicy ?? 'on_payment_or_due',
                graceDays: lastPay?.graceDays ?? 0,
              }}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <LinkedDocuments ctx={ctx} entityType="assignment" entityId={a.id} canAdd />
        <AuditHistory ctx={ctx} tableName="assignment" rowId={a.id} />
      </div>
    </div>
  );
}
