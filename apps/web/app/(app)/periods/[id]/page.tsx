import { formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BILLING_TYPE_LABELS, INVOICE_STATUS_LABELS } from '@/lib/labels';
import { monthTitle } from '@/lib/months';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPeriodOverview } from '@/server/services/periods';
import { CloseForm, HoursCsvForm, HoursForm, ParamsForm, ReopenForm } from './period-forms';

export const metadata: Metadata = { title: 'Період · Tally' };

function Step({
  n,
  title,
  description,
  children,
}: {
  n: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {n}. {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function PeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getPeriodOverview.run(ctx, { periodId: id });
  if (result.isErr()) notFound();
  const { period: p, assignments, preview, invoices } = result.value;
  const closed = p.status === 'closed';
  const billingText = (a: (typeof assignments)[number]) => {
    const b = preview.rows.find((r) => r.assignmentId === a.assignmentId)?.billing;
    if (!b || b.type === 'none') return 'не виставляється';
    return `${BILLING_TYPE_LABELS[b.type] ?? b.type} ${formatAmount(b.rate, b.currency)}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{monthTitle(p.month)}</h1>
          <p className="flex items-center gap-2 text-muted-foreground">
            <Badge variant={closed ? 'secondary' : 'default'}>
              {closed ? 'Закритий' : 'Відкритий'}
            </Badge>
            {closed && p.closedAt && (
              <span>
                закрито {formatUaDate(p.closedAt.toISOString().slice(0, 10) as LocalDate)}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" render={<a href={`/api/periods/${p.id}/hours`} />}>
          Шаблон годин (CSV)
        </Button>
      </div>

      <Step
        n={1}
        title="Параметри"
        description="Норма = робочі дні × 8 з урахуванням винятків календаря; можна змінити"
      >
        <ParamsForm
          periodId={p.id}
          workHours={p.workHours}
          referenceFx={p.referenceFxUsdUah}
          disabled={closed}
        />
      </Step>

      <Step n={2} title="Години" description="Години за активними залученнями місяця">
        <div className="flex flex-col gap-4">
          <HoursForm
            periodId={p.id}
            disabled={closed}
            rows={assignments.map((a) => ({
              assignmentId: a.assignmentId,
              personName: a.personName,
              clientName: a.clientName,
              roleTitle: a.roleTitle,
              billing: billingText(a),
              hours: a.hours,
            }))}
          />
          {!closed && <HoursCsvForm periodId={p.id} />}
        </div>
      </Step>

      <Step
        n={3}
        title="Розрахунок"
        description="Суми рахуються з усіх рядків; ЗП в UAH — орієнтовно за довідковим курсом"
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Людина</TableHead>
              <TableHead>Клієнт</TableHead>
              <TableHead>Години</TableHead>
              <TableHead>Інвойс</TableHead>
              <TableHead>ЗП, USD</TableHead>
              <TableHead>ЗП, UAH ≈</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((r) => (
              <TableRow key={r.assignmentId}>
                <TableCell>{r.personName}</TableCell>
                <TableCell>{r.clientName ?? 'внутрішнє'}</TableCell>
                <TableCell>{formatAmount(r.hours)}</TableCell>
                <TableCell>
                  {r.invoiceAmount ? formatAmount(r.invoiceAmount, r.billing?.currency) : '—'}
                </TableCell>
                <TableCell>{formatAmount(r.payUsd)}</TableCell>
                <TableCell>{r.payUahApprox ? formatAmount(r.payUahApprox) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3}>Разом</TableCell>
              <TableCell data-testid="total-invoice">
                {formatAmount(preview.totals.invoiceUsd)}
              </TableCell>
              <TableCell data-testid="total-pay">{formatAmount(preview.totals.payUsd)}</TableCell>
              <TableCell>
                {preview.totals.payUahApprox ? formatAmount(preview.totals.payUahApprox) : '—'}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Step>

      <Step
        n={4}
        title="Коригування"
        description="Бонуси, утримання й компенсації з причиною з’являться разом із виплатами (Етап 3)"
      >
        <p className="text-sm text-muted-foreground">—</p>
      </Step>

      <Step
        n={5}
        title={closed ? 'Період закрито' : 'Закриття'}
        description={
          closed
            ? 'Години незмінні. Відкрити знову може лише власник із причиною.'
            : 'Створює чернетки інвойсів: один інвойс на договір, рядки — залучення з годинами'
        }
      >
        <div className="flex flex-col gap-4">
          {closed ? (
            ctx.actor.role === 'owner' && <ReopenForm periodId={p.id} />
          ) : (
            <CloseForm periodId={p.id} />
          )}
          {invoices.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                    {i.clientName} — {i.number ?? 'чернетка'}
                  </Link>
                  <span>{formatAmount(i.total, i.currency)}</span>
                  <Badge variant="outline">{INVOICE_STATUS_LABELS[i.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Step>
    </div>
  );
}
