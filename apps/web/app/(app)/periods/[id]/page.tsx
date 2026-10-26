import { ChevronLeft, ChevronRight } from 'lucide-react';
import { sum, toDecimal } from '@tally/domain';
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
import { getPeriodOverview, listPeriods, periodDocuments } from '@/server/services/periods';
import {
  AdjustmentForm,
  CloseForm,
  EarlyActForm,
  EarlyInvoiceButton,
  HoursCsvForm,
  HoursForm,
  ParamsForm,
  RemoveAdjustmentButton,
  DeletePeriodForm,
  ReopenForm,
} from './period-forms';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { MergeActsButton, SplitActForm } from '../../payroll/payroll-forms';
import { DialogButton, RowMenu } from '@/components/v2/form-dialog';
import { PageHeader } from '@/components/v2/page-header';
import { Status } from '@/components/v2/status';
import { Wizard } from '@/components/v2/wizard';
import { getUiPrefs } from '@/server/ui-prefs';

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

export default async function PeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const [result, documents] = await Promise.all([
    getPeriodOverview.run(ctx, { periodId: id }),
    periodDocuments.run(ctx, { periodId: id }),
  ]);
  if (result.isErr()) notFound();
  const docs = documents.unwrapOr(null);
  const { period: p, assignments, preview, plan, adjustments, payroll, invoices } = result.value;
  const notes = new Map(assignments.map((a) => [a.assignmentId, a.note]));
  const closed = p.status === 'closed';
  const isEmpty =
    !closed &&
    assignments.every((a) => a.hours === null) &&
    adjustments.length === 0 &&
    invoices.length === 0 &&
    payroll.length === 0;
  const [
    t,
    tp,
    tc,
    fmt,
    { ADJUSTMENT_KIND_LABELS, BILLING_TYPE_LABELS, INVOICE_STATUS_LABELS, PAYOUT_METHOD_LABELS },
  ] = await Promise.all([
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

  const paramsStep = (
    <ParamsForm
      periodId={p.id}
      workHours={p.workHours}
      referenceFx={p.referenceFxUsdUah}
      disabled={closed}
    />
  );
  const hoursStep = (
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
  );
  const v2 = (await getUiPrefs()).version === 'v2';
  const people = [...new Map(assignments.map((a) => [a.personId ?? '', a.personName])).entries()]
    .filter(([pid]) => pid)
    .map(([pid, name]) => ({ id: pid, name }));
  const adjustStepV2 = (
    <div className="flex flex-col">
      <table className="w-full min-w-[36rem] text-sm tabular-nums">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="px-5 py-2.5 text-left font-normal">{t('planCol.payout')}</th>
            <th className="px-3 py-2.5 text-left font-normal">{t('planCol.method')}</th>
            <th className="px-3 py-2.5 text-right font-normal">{t('planCol.usd')}</th>
            <th className="px-5 py-2.5 text-right font-normal">{t('planCol.uah')}</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((i) => (
            <tr key={`${i.personId}:${i.payoutMethod}`} className="border-t">
              <td className="px-5 py-2.5">{i.personName}</td>
              <td className="px-3 py-2.5 text-muted-foreground">
                {PAYOUT_METHOD_LABELS[i.payoutMethod]}
              </td>
              <td className="px-3 py-2.5 text-right">{fmt.amount(i.totalUsd)}</td>
              <td className="px-5 py-2.5 text-right">
                {i.totalUahApprox ? fmt.amount(i.totalUahApprox) : '—'}
              </td>
            </tr>
          ))}
          <tr className="border-t font-bold">
            <td colSpan={2} className="px-5 py-3">
              {t('totalToPay')}
            </td>
            <td className="px-3 py-3 text-right">{fmt.amount(sum(plan.map((i) => i.totalUsd)))}</td>
            <td className="px-5 py-3 text-right" data-testid="total-pay-uah">
              {p.referenceFxUsdUah
                ? fmt.amount(sum(plan.map((i) => i.totalUahApprox ?? '0')))
                : '—'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
  const hoursTable = (
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
  );
  const calcStep = (
    <>
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
          {preview.lines.map((line) => {
            if (line.kind === 'adjustment') {
              const a = line.adjustment;
              return (
                <TableRow key={a.id} className="bg-muted/30" data-testid="calc-adjustment">
                  <TableCell>{a.personName}</TableCell>
                  <TableCell colSpan={4} className="max-w-[28rem]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="outline">{ADJUSTMENT_KIND_LABELS[a.kind] ?? a.kind}</Badge>
                      {a.payoutMethod !== 'fiat' && (
                        <Badge variant="outline">{PAYOUT_METHOD_LABELS[a.payoutMethod]}</Badge>
                      )}
                      <span className="min-w-0 truncate text-muted-foreground" title={a.reason}>
                        {a.reason}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {fmt.amount(a.amount, a.currency)}
                      {!closed && <RemoveAdjustmentButton id={a.id} periodId={p.id} />}
                    </div>
                  </TableCell>
                  <TableCell>{a.payUahApprox ? fmt.amount(a.payUahApprox) : '—'}</TableCell>
                </TableRow>
              );
            }
            const r = line.row;
            return (
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
                <TableCell>{fmt.amount(r.pay, r.payCurrency)}</TableCell>
                <TableCell>{r.payUahApprox ? fmt.amount(r.payUahApprox) : '—'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>{tc('total')}</TableCell>
            <TableCell data-testid="total-invoice">
              {fmt.amount(preview.totals.invoiceUsd)}
            </TableCell>
            <TableCell data-testid="total-pay">
              {[
                !toDecimal(preview.totals.payUsd).isZero() ||
                toDecimal(preview.totals.payUah).isZero()
                  ? fmt.amount(preview.totals.payUsd, 'USD')
                  : null,
                toDecimal(preview.totals.payUah).isZero()
                  ? null
                  : fmt.amount(preview.totals.payUah, 'UAH'),
              ]
                .filter(Boolean)
                .join(' + ')}
            </TableCell>
            <TableCell>
              {preview.totals.payUahApprox ? fmt.amount(preview.totals.payUahApprox) : '—'}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {!closed && !v2 && (
        <div className="mt-4">
          <AdjustmentForm periodId={p.id} people={people} />
        </div>
      )}
      {docs && (docs.invoices.length > 0 || docs.acts.length > 0) && (
        <div className="mt-6 flex flex-col gap-4">
          <div>
            <h3 className="font-medium">{t('earlyDocs')}</h3>
            <p className="text-sm text-muted-foreground">{t('earlyDocsDescription')}</p>
          </div>
          {docs.invoices.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('earlyInvoice')}</TableHead>
                  <TableHead>{t('col.person')}</TableHead>
                  <TableHead>{t('earlyState')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.invoices.map((g) => (
                  <TableRow key={`${g.contractId}:${g.annexId ?? ''}`}>
                    <TableCell>{g.label}</TableCell>
                    <TableCell className="text-muted-foreground">{g.people.join(', ')}</TableCell>
                    <TableCell>
                      {g.invoice ? (
                        <Link className="hover:underline" href={`/invoices/${g.invoice.id}`}>
                          {g.invoice.number ?? t('draft')} ·{' '}
                          {fmt.amount(g.invoice.total, g.invoice.currency)} ·{' '}
                          {INVOICE_STATUS_LABELS[g.invoice.status]}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {docs.open && (!g.invoice || g.invoice.status === 'draft') && (
                        <EarlyInvoiceButton
                          periodId={p.id}
                          contractId={g.contractId}
                          annexId={g.annexId}
                          label={g.invoice ? t('recalculate') : t('createInvoice')}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {docs.acts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('earlyAct')}</TableHead>
                  <TableHead>{t('earlyPay')}</TableHead>
                  <TableHead>{t('earlyState')}</TableHead>
                  <TableHead>{t('earlyRate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.acts.map((a) => (
                  <TableRow key={a.personId}>
                    <TableCell>
                      {a.personName}
                      <div className="text-xs text-muted-foreground">{a.payeeName}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {[
                        toDecimal(a.usd).isZero() ? null : fmt.amount(a.usd, 'USD'),
                        toDecimal(a.uah).isZero() ? null : fmt.amount(a.uah, 'UAH'),
                      ]
                        .filter(Boolean)
                        .join(' + ') || '—'}
                    </TableCell>
                    <TableCell>
                      {a.acts.length === 0 && '—'}
                      <ul className="flex flex-col gap-1">
                        {a.acts.map((act, n) => {
                          const next = a.acts[n + 1];
                          const activities = [
                            ...a.lines
                              .filter((l) => act.assignmentIds.includes(l.assignmentId))
                              .map((l) => ({
                                id: l.assignmentId,
                                kind: 'assignment' as const,
                                label: `${l.clientName ?? tc('internal')}${l.roleTitle ? ` · ${l.roleTitle}` : ''} · ${fmt.amount(l.amount, l.currency)}`,
                              })),
                            ...a.adjustments
                              .filter((j) => act.adjustmentIds.includes(j.id))
                              .map((j) => ({
                                id: j.id,
                                kind: 'adjustment' as const,
                                label: `${ADJUSTMENT_KIND_LABELS[j.kind] ?? j.kind}: ${fmt.amount(j.amount, j.currency)} — ${j.reason}`,
                              })),
                          ];
                          const splittable =
                            docs.open &&
                            act.status === 'draft' &&
                            act.payrollItemId === null &&
                            act.periodFrom !== null &&
                            act.periodTo !== null &&
                            act.periodFrom < act.periodTo;
                          const byAmount =
                            !toDecimal(a.usd).isZero() && (act.isRest || activities.length === 0);
                          return (
                            <li key={act.id} className="flex flex-wrap items-center gap-2">
                              <Link className="hover:underline" href={`/acts/${act.id}`}>
                                {act.number ?? t('draft')} · {fmt.amount(act.amountUah, 'UAH')}
                                {act.fxRate && ` · ${act.fxRate}`}
                              </Link>
                              {a.acts.length > 1 && act.periodFrom && act.periodTo && (
                                <span className="text-xs text-muted-foreground">
                                  {fmt.date(act.periodFrom)}–{fmt.date(act.periodTo)}
                                  {activities.length > 0 &&
                                    ` · ${activities.map((x) => x.label.split(' · ').slice(0, -1).join(' · ') || x.label).join(', ')}`}
                                </span>
                              )}
                              {docs.open &&
                                next &&
                                act.status === 'draft' &&
                                next.status === 'draft' && (
                                  <MergeActsButton firstId={act.id} secondId={next.id} />
                                )}
                              {splittable &&
                                act.periodFrom &&
                                act.periodTo &&
                                (activities.length > 1 || byAmount) && (
                                  <SplitActForm
                                    actId={act.id}
                                    periodFrom={act.periodFrom}
                                    periodTo={act.periodTo}
                                    activities={activities}
                                    byAmount={byAmount}
                                  />
                                )}
                            </li>
                          );
                        })}
                      </ul>
                    </TableCell>
                    <TableCell>
                      {docs.open && (!a.act || a.acts.some((x) => x.status === 'draft')) && (
                        <EarlyActForm
                          periodId={p.id}
                          personId={a.personId}
                          usd={a.usd}
                          uah={a.uah}
                          needsRate={a.needsRate}
                          defaultRate={a.act?.fxRate ?? docs.nbuRate}
                          label={a.act ? t('updateAct') : t('createAct')}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </>
  );
  const adjustStep = (
    <div className="flex flex-col gap-4">
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
              <TableCell>{PAYOUT_METHOD_LABELS[i.payoutMethod]}</TableCell>
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
  );
  const closeStep = (
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
  );

  if (v2) {
    const periods = (await listPeriods.run(ctx, {})).unwrapOr([]);
    const requested = Number((await searchParams).step);
    const step = requested >= 1 && requested <= 5 ? requested : closed ? 5 : 2;
    // Newest first: the next entry is the previous month.
    const index = periods.findIndex(({ period: x }) => x.id === p.id);
    const older = periods[index + 1]?.period;
    const newer = index > 0 ? periods[index - 1]?.period : undefined;
    const arrow = (target: typeof older, label: string, icon: React.ReactNode) =>
      target ? (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={label}
          title={fmt.month(target.month)}
          render={<Link href={`/periods/${target.id}?step=${String(step)}`} />}
        >
          {icon}
        </Button>
      ) : (
        <Button size="icon-sm" variant="outline" aria-label={label} disabled>
          {icon}
        </Button>
      );
    const filled = assignments.filter((a) => a.hours !== null).length;
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={fmt.month(p.month)}
          leading={arrow(older, tc('previous'), <ChevronLeft />)}
          badges={
            <>
              {arrow(newer, tc('next'), <ChevronRight />)}
              <Status tone={closed ? 'success' : 'info'} testId="period-status">
                {closed ? tp('statusClosed') : tp('statusOpen')}
              </Status>
            </>
          }
          meta={
            closed && p.closedAt
              ? t('closedOn', { date: fmt.date(p.closedAt.toISOString().slice(0, 10)) })
              : undefined
          }
        >
          <RowMenu
            label={tc('actions')}
            entries={[
              { label: t('hoursTemplate'), href: `/api/periods/${p.id}/hours`, download: true },
              payroll.length > 0 && { label: t('toPayroll'), href: `/payroll?period=${p.id}` },
              isEmpty && {
                label: t('v2.delete'),
                destructive: true,
                dialog: { title: t('v2.delete'), content: <DeletePeriodForm periodId={p.id} /> },
              },
            ]}
          />
        </PageHeader>
        <Wizard
          current={step}
          allDone={closed}
          hrefOf={(n) => `/periods/${p.id}?step=${String(n)}`}
          footer={
            step === 2 ? t('v2.summary.hours', { filled, total: assignments.length }) : undefined
          }
          labels={{
            steps: t('v2.steps'),
            back: tc('back'),
            next: (title) => t('v2.next', { step: title }),
            help: tc('help'),
          }}
          steps={[
            {
              title: t('step1'),
              summary: t('v2.summary.params', {
                norm: fmt.amount(p.workHours),
                fx: p.referenceFxUsdUah ? fmt.amount(p.referenceFxUsdUah) : '—',
              }),
              help: t('step1Description'),
              content: paramsStep,
            },
            {
              title: t('step2'),
              summary: t('v2.summary.hours', { filled, total: assignments.length }),
              help: `${t('step2Description')}. ${t('v2.emptyHours')}`,
              flush: true,
              actions: closed ? undefined : (
                <DialogButton
                  variant="outline"
                  title={t('v2.importTitle')}
                  description={t('v2.importHint')}
                  content={<HoursCsvForm periodId={p.id} />}
                >
                  {t('v2.import')}
                </DialogButton>
              ),
              content: hoursTable,
            },
            {
              title: t('step3'),
              summary: [
                t('v2.summary.rows', { count: preview.rows.length }),
                adjustments.length > 0 &&
                  t('v2.summary.adjustments', { count: adjustments.length }),
              ]
                .filter(Boolean)
                .join(' · '),
              help: t('step3Description'),
              actions: closed ? undefined : (
                <DialogButton
                  variant="outline"
                  title={t('v2.adjustmentTitle')}
                  content={<AdjustmentForm periodId={p.id} people={people} />}
                >
                  + {t('v2.adjustment')}
                </DialogButton>
              ),
              content: calcStep,
            },
            {
              title: t('step4'),
              summary: t('v2.summary.payouts', { count: plan.length }),
              help: t('step4Description'),
              flush: true,
              content: adjustStepV2,
            },
            {
              title: closed ? t('step5Closed') : t('step5'),
              summary: closed
                ? tp('statusClosed')
                : t('v2.summary.invoices', { count: invoices.length }),
              help: closed ? t('step5ClosedDescription') : t('step5Description'),
              content: closeStep,
            },
          ]}
        />
      </div>
    );
  }

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
        <div className="flex items-start gap-2">
          {isEmpty && <DeletePeriodForm periodId={p.id} />}
          <Button variant="outline" render={<a href={`/api/periods/${p.id}/hours`} />}>
            {t('hoursTemplate')}
          </Button>
        </div>
      </div>

      <Step n={1} title={t('step1')} description={t('step1Description')}>
        {paramsStep}
      </Step>

      <Step n={2} title={t('step2')} description={t('step2Description')}>
        {hoursStep}
      </Step>

      <Step n={3} title={t('step3')} description={t('step3Description')}>
        {calcStep}
      </Step>

      <Step n={4} title={t('step4')} description={t('step4Description')}>
        {adjustStep}
      </Step>

      <Step
        n={5}
        title={closed ? t('step5Closed') : t('step5')}
        description={closed ? t('step5ClosedDescription') : t('step5Description')}
      >
        {closeStep}
      </Step>
    </div>
  );
}
