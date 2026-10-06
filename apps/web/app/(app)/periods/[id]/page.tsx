import { sum } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
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
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('period');

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
  const [t, tp, tc, fmt, { ADJUSTMENT_KIND_LABELS, BILLING_TYPE_LABELS, INVOICE_STATUS_LABELS }] =
    await Promise.all([
      getTranslations('period'),
      getTranslations('periods'),
      getTranslations('common'),
      getFormat(),
      getLabels(),
    ]);
  const billingText = (a: (typeof assignments)[number]) => {
    const b = preview.rows.find((r) => r.assignmentId === a.assignmentId)?.billing;
    if (!b || b.type === 'none') return t('notBilled');
    return `${BILLING_TYPE_LABELS[b.type] ?? b.type} ${fmt.amount(b.rate, b.currency)}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{fmt.month(p.month)}</h1>
          <p className="flex items-center gap-2 text-muted-foreground">
            <Badge variant={closed ? 'secondary' : 'default'}>
              {closed ? tp('statusClosed') : tp('statusOpen')}
            </Badge>
            {closed && p.closedAt && (
              <span>
                {t('closedOn', { date: fmt.date(p.closedAt.toISOString().slice(0, 10)) })}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" render={<a href={`/api/periods/${p.id}/hours`} />}>
          {t('hoursTemplate')}
        </Button>
      </div>

      <Step n={1} title={t('step1')} description={t('step1Description')}>
        <ParamsForm
          periodId={p.id}
          workHours={p.workHours}
          referenceFx={p.referenceFxUsdUah}
          disabled={closed}
        />
      </Step>

      <Step n={2} title={t('step2')} description={t('step2Description')}>
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
              payHours: a.payHours ?? null,
              note: a.note ?? null,
            }))}
          />
          {!closed && <HoursCsvForm periodId={p.id} />}
        </div>
      </Step>

      <Step n={3} title={t('step3')} description={t('step3Description')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.person')}</TableHead>
              <TableHead>{t('col.client')}</TableHead>
              <TableHead>{t('col.hours')}</TableHead>
              <TableHead>{t('col.payHours')}</TableHead>
              <TableHead>{t('col.invoice')}</TableHead>
              <TableHead>{t('col.payUsd')}</TableHead>
              <TableHead>{t('col.payUah')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((r) => (
              <TableRow key={r.assignmentId}>
                <TableCell>{r.personName}</TableCell>
                <TableCell>
                  {r.clientName ?? tc('internal')}
                  {notes.get(r.assignmentId) && (
                    <div className="text-xs text-muted-foreground">{notes.get(r.assignmentId)}</div>
                  )}
                </TableCell>
                <TableCell>{fmt.amount(r.hours)}</TableCell>
                <TableCell className={r.payHours === r.hours ? 'text-muted-foreground' : undefined}>
                  {fmt.amount(r.payHours)}
                </TableCell>
                <TableCell>
                  {r.invoiceAmount ? fmt.amount(r.invoiceAmount, r.billing?.currency) : '—'}
                </TableCell>
                <TableCell>{fmt.amount(r.payUsd)}</TableCell>
                <TableCell>{r.payUahApprox ? fmt.amount(r.payUahApprox) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4}>{tc('total')}</TableCell>
              <TableCell data-testid="total-invoice">
                {fmt.amount(preview.totals.invoiceUsd)}
              </TableCell>
              <TableCell data-testid="total-pay">{fmt.amount(preview.totals.payUsd)}</TableCell>
              <TableCell>
                {preview.totals.payUahApprox ? fmt.amount(preview.totals.payUahApprox) : '—'}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Step>

      <Step n={4} title={t('step4')} description={t('step4Description')}>
        <div className="flex flex-col gap-4">
          {adjustments.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {adjustments.map(({ adjustment: a, personName }) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{personName}</span>
                  <Badge variant="outline">{ADJUSTMENT_KIND_LABELS[a.kind] ?? a.kind}</Badge>
                  <span className="tabular-nums">{fmt.amount(a.amount, a.currency)}</span>
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
                <TableHead>{t('planCol.payout')}</TableHead>
                <TableHead>{t('planCol.method')}</TableHead>
                <TableHead>{t('planCol.usd')}</TableHead>
                <TableHead>{t('planCol.uah')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.map((i) => (
                <TableRow key={`${i.personId}:${i.payoutMethod}`}>
                  <TableCell>{i.personName}</TableCell>
                  <TableCell>{i.payoutMethod === 'crypto' ? 'crypto' : 'fiat'}</TableCell>
                  <TableCell>{fmt.amount(i.totalUsd)}</TableCell>
                  <TableCell>{i.totalUahApprox ? fmt.amount(i.totalUahApprox) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>{t('totalToPay')}</TableCell>
                <TableCell>{fmt.amount(sum(plan.map((i) => i.totalUsd)))}</TableCell>
                <TableCell data-testid="total-pay-uah">
                  {p.referenceFxUsdUah
                    ? fmt.amount(sum(plan.map((i) => i.totalUahApprox ?? '0')))
                    : '—'}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </Step>

      <Step
        n={5}
        title={closed ? t('step5Closed') : t('step5')}
        description={closed ? t('step5ClosedDescription') : t('step5Description')}
      >
        <div className="flex flex-col gap-4">
          {closed ? (
            ctx.actor.role === 'owner' && <ReopenForm periodId={p.id} />
          ) : (
            <CloseForm periodId={p.id} />
          )}
          {payroll.length > 0 && (
            <p className="text-sm">
              {t('payoutsCreated', { count: payroll.length })}{' '}
              <Link href={`/payroll?period=${p.id}`} className="underline">
                {t('toPayroll')}
              </Link>
            </p>
          )}
          {invoices.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <Link href={`/invoices/${i.id}`} className="font-medium hover:underline">
                    {i.clientName} — {i.number ?? t('draft')}
                  </Link>
                  <span>{fmt.amount(i.total, i.currency)}</span>
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
