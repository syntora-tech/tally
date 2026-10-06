import { addMonths, toDecimal } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
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
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { agencyPayeeOptions, getAssignment } from '@/server/services/assignments';
import { AddVersionForm } from '../add-version-form';
import { AgencyVersionForm } from '../agency-version-form';
import { EditVersionButton } from '../edit-version-button';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

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

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('billingVersions')}</CardTitle>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('payVersions')}</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('agencyTitle')}</CardTitle>
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
    </div>
  );
}
