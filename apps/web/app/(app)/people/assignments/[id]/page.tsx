import { addMonths, isAssignmentActive, toDecimal, type LocalDate } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { agencyPayeeOptions, getAssignment } from '@/server/services/assignments';
import { AddVersionForm } from '../add-version-form';
import { AgencyVersionForm } from '../agency-version-form';
import { EditVersionButton } from '../edit-version-button';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { HelpTip } from '@/components/v2/help-tip';
import { PageHeader } from '@/components/v2/page-header';
import { Status } from '@/components/v2/status';
import { getUiPrefs } from '@/server/ui-prefs';
import { DialogButton } from '@/components/v2/form-dialog';
import { Panel } from '@/components/v2/panel';
import { cn } from 'cn';

export const generateMetadata = pageTitle('assignment');

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
    contractCurrency,
    annexLabel,
    billing,
    pay,
    agency,
    hours,
    margin,
    closedEnd,
  } = result.value;
  const editable = (validFrom: string) => !closedEnd || validFrom > closedEnd;
  const payees = (await agencyPayeeOptions.run(ctx, {})).unwrapOr([]);
  const lastAgency = agency[0]?.terms;
  const nextMonth = addMonths(ctx.today, 1).slice(0, 7);
  const [lastBilling] = billing;
  const [lastPay] = pay;
  const [t, tc, fmt, labels] = await Promise.all([
    getTranslations('assignment'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);
  const {
    BILLING_TYPE_LABELS,
    PAY_TYPE_LABELS,
    PAYOUT_METHOD_LABELS,
    PRORATION_LABELS,
    RELEASE_POLICY_LABELS,
  } = labels;
  const month = fmt.month;

  const billingForm = (
    <AddVersionForm
      side="billing"
      assignmentId={a.id}
      suggestedMonth={nextMonth}
      defaults={{
        type: lastBilling?.type ?? 'hourly',
        rate: lastBilling?.rate ?? '',
        currency: contractCurrency ?? 'USD',
        prorationPolicy: lastBilling?.prorationPolicy ?? 'full_month',
        invoiceChannel: lastBilling?.invoiceChannel ?? 'fiat',
      }}
    />
  );
  const payForm = (
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
  );
  const agencyForm = (
    <AgencyVersionForm
      assignmentId={a.id}
      suggestedMonth={nextMonth}
      payees={payees}
      defaults={
        lastAgency
          ? {
              payeeId: lastAgency.payeeId,
              ratePerHour: toDecimal(lastAgency.ratePerHour).toString(),
              payoutMethod: lastAgency.payoutMethod,
              releasePolicy: lastAgency.releasePolicy,
              graceDays: lastAgency.graceDays,
            }
          : null
      }
    />
  );
  const details = (inline: boolean) => (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('billingVersions')}</CardTitle>
            {!inline && (
              <CardAction>
                <DialogButton variant="outline" title={t('billingVersions')} content={billingForm}>
                  {t('v2.addVersion')}
                </DialogButton>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fromMonth')}</TableHead>
                  <TableHead>{t('type')}</TableHead>
                  <TableHead>{t('rate')}</TableHead>
                  <TableHead>{t('details')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {billing.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{month(b.validFrom)}</TableCell>
                    <TableCell>{BILLING_TYPE_LABELS[b.type]}</TableCell>
                    <TableCell>
                      {b.type === 'none' ? '—' : fmt.amount(b.rate, b.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.type === 'fixed_monthly' ? PRORATION_LABELS[b.prorationPolicy] : ''}{' '}
                      <Badge variant="outline">{PAYOUT_METHOD_LABELS[b.invoiceChannel]}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {editable(b.validFrom) ? (
                        <EditVersionButton
                          side="billing"
                          assignmentId={a.id}
                          versionId={b.id}
                          validFrom={b.validFrom}
                          label={month(b.validFrom)}
                          values={{
                            type: b.type,
                            rate: b.rate,
                            currency: b.currency,
                            prorationPolicy: b.prorationPolicy,
                            invoiceChannel: b.invoiceChannel,
                          }}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('versionClosed')}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {inline && billingForm}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('payVersions')}</CardTitle>
            {!inline && (
              <CardAction>
                <DialogButton variant="outline" title={t('payVersions')} content={payForm}>
                  {t('v2.addVersion')}
                </DialogButton>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fromMonth')}</TableHead>
                  <TableHead>{t('type')}</TableHead>
                  <TableHead>{t('amount')}</TableHead>
                  <TableHead>{t('details')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pay.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{month(p.validFrom)}</TableCell>
                    <TableCell>{PAY_TYPE_LABELS[p.type]}</TableCell>
                    <TableCell>
                      {p.type === 'included' ? '—' : fmt.amount(p.amount, p.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PAYOUT_METHOD_LABELS[p.payoutMethod]} ·{' '}
                      {RELEASE_POLICY_LABELS[p.releasePolicy]}
                      {p.graceDays > 0 ? t('graceDays', { days: p.graceDays }) : ''}
                    </TableCell>
                    <TableCell className="text-right">
                      {editable(p.validFrom) ? (
                        <EditVersionButton
                          side="pay"
                          assignmentId={a.id}
                          versionId={p.id}
                          validFrom={p.validFrom}
                          label={month(p.validFrom)}
                          values={{
                            type: p.type,
                            amount: p.amount,
                            currency: p.currency,
                            payoutMethod: p.payoutMethod,
                            releasePolicy: p.releasePolicy,
                            graceDays: p.graceDays,
                          }}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('versionClosed')}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {inline && payForm}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('agencyTitle')}</CardTitle>
          {!inline && (
            <CardAction>
              <DialogButton variant="outline" title={t('agencyTitle')} wide content={agencyForm}>
                {t('v2.addVersion')}
              </DialogButton>
            </CardAction>
          )}
          <CardDescription>{t('agencyDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {agency.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('fromMonth')}</TableHead>
                  <TableHead>{t('agency')}</TableHead>
                  <TableHead>{t('ratePerHour')}</TableHead>
                  <TableHead>{t('details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agency.map(({ terms: v, payeeName }) => (
                  <TableRow key={v.id}>
                    <TableCell>{month(v.validFrom)}</TableCell>
                    <TableCell>{payeeName}</TableCell>
                    <TableCell>
                      {toDecimal(v.ratePerHour).isZero()
                        ? t('agencyEnded')
                        : fmt.amount(v.ratePerHour, v.currency)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PAYOUT_METHOD_LABELS[v.payoutMethod]} ·{' '}
                      {RELEASE_POLICY_LABELS[v.releasePolicy]}
                      {v.graceDays > 0 ? t('graceDays', { days: v.graceDays }) : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {inline && agencyForm}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('hours')}</CardTitle>
          <CardDescription>{t('hoursDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {hours.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noHours')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('month')}</TableHead>
                  <TableHead>{t('hours')}</TableHead>
                  <TableHead>{t('norm')}</TableHead>
                  <TableHead>{t('source')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hours.map((h) => (
                  <TableRow key={h.month}>
                    <TableCell>{month(h.month)}</TableCell>
                    <TableCell>{fmt.amount(h.hours)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmt.amount(h.workHours)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {h.source === 'import' ? t('sourceImport') : t('sourceManual')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <LinkedDocuments ctx={ctx} entityType="assignment" entityId={a.id} canAdd />
        <AuditHistory ctx={ctx} tableName="assignment" rowId={a.id} />
      </div>
    </>
  );

  if ((await getUiPrefs()).version === 'v2') {
    const active = isAssignmentActive(
      { startsOn: a.startsOn as LocalDate, endsOn: a.endsOn as LocalDate | null },
      ctx.today,
    );
    const tp = await getTranslations('personAssignments');
    const thisMonth = ctx.today.slice(0, 7);
    // Versions are newest first: the first one not in the future is the one in force.
    const inForce = <V extends { validFrom: string }>(list: V[]) =>
      list.find((v) => v.validFrom.slice(0, 7) <= thisMonth);
    const billingNow = inForce(billing);
    const payNow = inForce(pay);
    const hero = (label: React.ReactNode, value: string, testId?: string) => (
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-sm opacity-70">{label}</span>
        <span
          className="font-heading text-2xl font-bold tracking-tight tabular-nums"
          data-testid={testId}
        >
          {value}
        </span>
      </div>
    );
    const versionRow = (
      key: string,
      main: React.ReactNode,
      detail: React.ReactNode,
      validFrom: string,
      current: boolean,
      edit: React.ReactNode,
    ) => (
      <li key={key} className="group relative flex gap-3 pb-4 last:pb-0">
        <span
          aria-hidden
          className={cn(
            'relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full',
            current ? 'bg-foreground dark:bg-neon' : 'border-2 border-input bg-card',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <b className="font-semibold tabular-nums">{main}</b>
            {current && <Status tone="success">{t('v2.inForce')}</Status>}
          </span>
          <span className="text-xs text-muted-foreground">
            {month(validFrom)} · {detail}
          </span>
        </span>
        <span className="opacity-100 transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          {edit}
        </span>
      </li>
    );
    const timeline = (children: React.ReactNode) => (
      <ol className="relative flex flex-col before:absolute before:top-2 before:bottom-2 before:left-[4px] before:w-px before:bg-border">
        {children}
      </ol>
    );
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={`${personName} → ${a.isInternal ? t('internal') : (clientName ?? '')}`}
          crumb={a.isInternal ? t('internal') : (clientName ?? '')}
          crumbParents={[{ label: personName, href: `/people/${a.personId}` }]}
          badges={
            <Status tone={active ? 'success' : 'neutral'}>
              {active ? tp('active') : tp('inactive')}
            </Status>
          }
          meta={
            <>
              {[a.roleTitle, annexLabel ?? a.sowRef, contractNumber, `FTE ${a.fte}`]
                .filter(Boolean)
                .join(' · ')}{' '}
              · {fmt.date(a.startsOn)} — {a.endsOn ? fmt.date(a.endsOn) : t('noEnd')}
              {!a.isInternal && clientId && (
                <>
                  {' · '}
                  <Link href={`/clients/${clientId}`} className="text-link hover:underline">
                    {clientName}
                  </Link>
                </>
              )}
            </>
          }
        >
          <Button variant="outline" render={<Link href={`/people/assignments/${a.id}/edit`} />}>
            {tc('edit')}
          </Button>
        </PageHeader>
        {margin ? (
          <section
            aria-label={t('margin')}
            className="grid grid-cols-1 gap-5 rounded-lg bg-[#0E0E11] px-6 py-5 text-[#FCFCFC] sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] dark:border dark:bg-card dark:text-foreground"
          >
            {hero(t('toClient'), fmt.amount(margin.billing, margin.currency))}
            {hero(t('toPerson'), fmt.amount(margin.pay, margin.currency))}
            {margin.agency !== '0.00' &&
              hero(t('agencyTitle'), fmt.amount(margin.agency, margin.currency))}
            {hero(
              <>
                {t('margin')}
                <HelpTip label={tc('help')} className="border-white/30 bg-transparent text-inherit">
                  {t('marginDescription', {
                    basis: t('marginBasis', {
                      month: month(margin.month),
                      hours: margin.workHours,
                    }),
                  })}
                </HelpTip>
              </>,
              fmt.amount(margin.margin, margin.currency),
              'assignment-margin',
            )}
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noMargin')}</p>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
          <Panel
            title={t('billingVersions')}
            action={
              <DialogButton variant="outline" title={t('billingVersions')} content={billingForm}>
                {t('v2.addVersion')}
              </DialogButton>
            }
          >
            {timeline(
              billing.map((b) =>
                versionRow(
                  b.id,
                  b.type === 'none' ? BILLING_TYPE_LABELS[b.type] : fmt.amount(b.rate, b.currency),
                  [
                    b.type === 'none' ? null : BILLING_TYPE_LABELS[b.type],
                    b.type === 'fixed_monthly' ? PRORATION_LABELS[b.prorationPolicy] : null,
                    PAYOUT_METHOD_LABELS[b.invoiceChannel],
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  b.validFrom,
                  b.id === billingNow?.id,
                  editable(b.validFrom) ? (
                    <EditVersionButton
                      side="billing"
                      assignmentId={a.id}
                      versionId={b.id}
                      validFrom={b.validFrom}
                      label={month(b.validFrom)}
                      values={{
                        type: b.type,
                        rate: b.rate,
                        currency: b.currency,
                        prorationPolicy: b.prorationPolicy,
                        invoiceChannel: b.invoiceChannel,
                      }}
                    />
                  ) : null,
                ),
              ),
            )}
          </Panel>
          <Panel
            title={t('payVersions')}
            action={
              <DialogButton variant="outline" title={t('payVersions')} content={payForm}>
                {t('v2.addVersion')}
              </DialogButton>
            }
          >
            {timeline(
              pay.map((v) =>
                versionRow(
                  v.id,
                  v.type === 'included'
                    ? PAY_TYPE_LABELS[v.type]
                    : fmt.amount(v.amount, v.currency),
                  [
                    v.type === 'included' ? null : PAY_TYPE_LABELS[v.type],
                    PAYOUT_METHOD_LABELS[v.payoutMethod],
                    `${RELEASE_POLICY_LABELS[v.releasePolicy]}${
                      v.graceDays > 0 ? t('graceDays', { days: v.graceDays }) : ''
                    }`,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  v.validFrom,
                  v.id === payNow?.id,
                  editable(v.validFrom) ? (
                    <EditVersionButton
                      side="pay"
                      assignmentId={a.id}
                      versionId={v.id}
                      validFrom={v.validFrom}
                      label={month(v.validFrom)}
                      values={{
                        type: v.type,
                        amount: v.amount,
                        currency: v.currency,
                        payoutMethod: v.payoutMethod,
                        releasePolicy: v.releasePolicy,
                        graceDays: v.graceDays,
                      }}
                    />
                  ) : null,
                ),
              ),
            )}
          </Panel>
        </div>
        <Panel
          title={t('agencyTitle')}
          help={t('agencyDescription')}
          helpLabel={tc('help')}
          action={
            <DialogButton variant="outline" title={t('agencyTitle')} wide content={agencyForm}>
              {agency.length ? t('v2.addVersion') : tc('add')}
            </DialogButton>
          }
        >
          {agency.length === 0 ? (
            <p className="text-muted-foreground">{t('v2.noAgency')}</p>
          ) : (
            timeline(
              agency.map(({ terms: v, payeeName }, i) =>
                versionRow(
                  v.id,
                  toDecimal(v.ratePerHour).isZero()
                    ? t('agencyEnded')
                    : `${fmt.amount(v.ratePerHour, v.currency)} · ${payeeName}`,
                  `${PAYOUT_METHOD_LABELS[v.payoutMethod]} · ${RELEASE_POLICY_LABELS[v.releasePolicy]}${
                    v.graceDays > 0 ? t('graceDays', { days: v.graceDays }) : ''
                  }`,
                  v.validFrom,
                  i === agency.findIndex(({ terms }) => terms.validFrom.slice(0, 7) <= thisMonth),
                  null,
                ),
              ),
            )
          )}
        </Panel>
        <Panel
          title={t('hours')}
          flush
          action={
            <Link href="/periods" className="text-sm font-medium text-link hover:underline">
              {t('v2.hoursInWizard')}
            </Link>
          }
        >
          {hours.length === 0 ? (
            <p className="px-5 py-4 text-muted-foreground">{t('noHours')}</p>
          ) : (
            <table className="w-full min-w-[28rem] text-sm tabular-nums">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2.5 text-left font-normal">{t('month')}</th>
                  <th className="px-3 py-2.5 text-right font-normal">{t('hours')}</th>
                  <th className="px-3 py-2.5 text-right font-normal">{t('norm')}</th>
                  <th className="px-5 py-2.5 text-left font-normal">{t('source')}</th>
                </tr>
              </thead>
              <tbody>
                {hours.map((h) => (
                  <tr key={h.month} className="border-t">
                    <td className="px-5 py-2.5">{month(h.month)}</td>
                    <td className="px-3 py-2.5 text-right">{fmt.amount(h.hours)}</td>
                    <td className="px-3 py-2.5 text-right text-muted-foreground">
                      {fmt.amount(h.workHours)}
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground">
                      {h.source === 'import' ? t('sourceImport') : t('sourceManual')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
          <LinkedDocuments ctx={ctx} entityType="assignment" entityId={a.id} canAdd />
          <AuditHistory ctx={ctx} tableName="assignment" rowId={a.id} />
        </div>
      </div>
    );
  }

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
              t('internal')
            ) : (
              <Link href={`/clients/${clientId ?? ''}`} className="hover:underline">
                {clientName}
              </Link>
            )}
          </h1>
          <p className="text-muted-foreground">
            {[a.roleTitle, annexLabel ?? a.sowRef, contractNumber].filter(Boolean).join(' · ')} ·
            FTE {a.fte} · {fmt.date(a.startsOn)} — {a.endsOn ? fmt.date(a.endsOn) : t('noEnd')}
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/people/assignments/${a.id}/edit`} />}>
          {tc('edit')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('marginTitle')}</CardTitle>
          <CardDescription>
            {t('marginDescription', {
              basis: margin
                ? t('marginBasis', { month: month(margin.month), hours: margin.workHours })
                : t('currentMonth'),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {margin ? (
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">{t('toClient')}</div>
                <div className="text-lg font-medium">
                  {fmt.amount(margin.billing, margin.currency)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('toPerson')}</div>
                <div className="text-lg font-medium">{fmt.amount(margin.pay, margin.currency)}</div>
              </div>
              {margin.agency !== '0.00' && (
                <div>
                  <div className="text-muted-foreground">{t('agencyTitle')}</div>
                  <div className="text-lg font-medium">
                    {fmt.amount(margin.agency, margin.currency)}
                  </div>
                </div>
              )}
              <div>
                <div className="text-muted-foreground">{t('margin')}</div>
                <div className="text-lg font-semibold" data-testid="assignment-margin">
                  {fmt.amount(margin.margin, margin.currency)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noMargin')}</p>
          )}
        </CardContent>
      </Card>

      {details(true)}
    </div>
  );
}
