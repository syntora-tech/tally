import { formatAmount, formatUaDate, sum, type LocalDate } from '@tally/domain';
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
import { ADJUSTMENT_KIND_LABELS, BILLING_TYPE_LABELS, INVOICE_STATUS_LABELS } from '@/lib/labels';
import { monthTitle } from '@/lib/months';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPeriodOverview } from '@/server/services/periods';
import {
  AdjustmentForm,
  CloseForm,
  HoursCsvForm,
  HoursForm,
  ParamsForm,
  RemoveAdjustmentButton,
  ReopenForm,
} from './period-forms';

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
  const { period: p, assignments, preview, plan, adjustments, payroll, invoices } = result.value;
  const notes = new Map(assignments.map((a) => [a.assignmentId, a.note]));
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
              note: a.note ?? null,
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
                <TableCell>
                  {r.clientName ?? 'внутрішнє'}
                  {notes.get(r.assignmentId) && (
                    <div className="text-xs text-muted-foreground">{notes.get(r.assignmentId)}</div>
                  )}
                </TableCell>
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
        description="Бонус, утримання чи компенсація з причиною; UAH додається до виплати після конвертації"
      >
        <div className="flex flex-col gap-4">
          {adjustments.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {adjustments.map(({ adjustment: a, personName }) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{personName}</span>
                  <Badge variant="outline">{ADJUSTMENT_KIND_LABELS[a.kind] ?? a.kind}</Badge>
                  <span className="tabular-nums">{formatAmount(a.amount, a.currency)}</span>
                  {a.payoutMethod === 'crypto' && <Badge variant="outline">crypto</Badge>}
                  <span className="text-muted-foreground">{a.reason}</span>
                  {!closed && <RemoveAdjustmentButton id={a.id} periodId={p.id} />}
                </li>
              ))}
            </ul>
          )}
          {!closed && (
            <AdjustmentForm
              periodId={p.id}
              people={[
                ...new Map(assignments.map((a) => [a.personId ?? '', a.personName])).entries(),
              ]
                .filter(([id]) => id)
                .map(([id, name]) => ({ id, name }))}
            />
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Виплата</TableHead>
                <TableHead>Спосіб</TableHead>
                <TableHead>USD</TableHead>
                <TableHead>UAH ≈ з коригуваннями</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.map((i) => (
                <TableRow key={`${i.personId}:${i.payoutMethod}`}>
                  <TableCell>{i.personName}</TableCell>
                  <TableCell>{i.payoutMethod === 'crypto' ? 'crypto' : 'fiat'}</TableCell>
                  <TableCell>{formatAmount(i.totalUsd)}</TableCell>
                  <TableCell>{i.totalUahApprox ? formatAmount(i.totalUahApprox) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>Разом до виплати</TableCell>
                <TableCell>{formatAmount(sum(plan.map((i) => i.totalUsd)))}</TableCell>
                <TableCell data-testid="total-pay-uah">
                  {p.referenceFxUsdUah
                    ? formatAmount(sum(plan.map((i) => i.totalUahApprox ?? '0')))
                    : '—'}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </Step>

      <Step
        n={5}
        title={closed ? 'Період закрито' : 'Закриття'}
        description={
          closed
            ? 'Години незмінні. Відкрити знову може лише власник із причиною.'
            : 'Створює чернетки інвойсів (один на договір) і виплати; статуси рядків — за оплатою клієнта (5.3)'
        }
      >
        <div className="flex flex-col gap-4">
          {closed ? (
            ctx.actor.role === 'owner' && <ReopenForm periodId={p.id} />
          ) : (
            <CloseForm periodId={p.id} />
          )}
          {payroll.length > 0 && (
            <p className="text-sm">
              Виплат створено: {payroll.length}.{' '}
              <Link href={`/payroll?period=${p.id}`} className="underline">
                Перейти до виплат
              </Link>
            </p>
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
