import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { AutoRefresh } from '@/components/auto-refresh';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import {
  contractorInvoiceNumber,
  getContractorInvoice,
  renderContractorInvoiceJob,
} from '@/server/services/contractor-invoices';
import { jobPending } from '@/server/services/settings';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import type { LocalDate } from '@tally/domain';
import {
  ContractorInvoiceDraftForm,
  DeleteContractorInvoiceForm,
  IssueContractorInvoiceForm,
  RerenderContractorInvoiceForm,
  SignContractorInvoiceForm,
  VoidContractorInvoiceForm,
} from '../contractor-invoice-forms';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { Status } from '@/components/v2/status';
import { RowMenu } from '@/components/v2/form-dialog';
import { CardLayout, Fact, Facts, FactsRule, Panel } from '@/components/v2/panel';
import { Steps } from '@/components/v2/steps';

export const generateMetadata = pageTitle('contractorInvoice');

export default async function ContractorInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getContractorInvoice.run(ctx, { id });
  if (result.isErr()) notFound();
  const { invoice: inv, payeeName, contractNumber, personName, month, payout } = result.value;
  const draft = inv.status === 'draft';
  const rendering =
    inv.status === 'issued' &&
    !inv.pdfFileId &&
    (
      await jobPending.run(ctx, {
        dedupeKeys: [renderContractorInvoiceJob(inv.id).dedupeKey ?? ''],
      })
    ).unwrapOr(false);
  const [t, fmt, { DOC_STATUS_LABELS }] = await Promise.all([
    getTranslations('contractorInvoice'),
    getFormat(),
    getLabels(),
  ]);

  const v2 = (await getUiPrefs()).version === 'v2';
  if (v2) {
    const tc = await getTranslations('common');
    const signed = Boolean(inv.signedAt);
    const paid = payout?.status === 'paid';
    const payHref = payout ? `/payroll?period=${payout.periodId}&pay=${payout.itemId}` : null;
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={inv.number ? t('titleNumber', { number: inv.number }) : t('titleDraft')}
          crumb={inv.number ?? t('titleDraft')}
          badges={
            <Status
              tone={
                draft
                  ? 'neutral'
                  : inv.status === 'void'
                    ? 'danger'
                    : signed
                      ? 'success'
                      : 'warning'
              }
            >
              {DOC_STATUS_LABELS[inv.status] ?? inv.status}
            </Status>
          }
          meta={`${t('subtitle', { payee: payeeName, contract: contractNumber })}${
            personName && month ? ` · ${personName} · ${fmt.month(month)}` : ''
          }`}
        >
          <RowMenu
            label={tc('actions')}
            entries={[
              draft && {
                label: `${tc('delete')}…`,
                destructive: true,
                dialog: {
                  title: t('titleDraft'),
                  content: <DeleteContractorInvoiceForm id={inv.id} />,
                },
              },
              inv.status === 'issued' && {
                label: `${t('rerender')}…`,
                dialog: {
                  title: t('rerender'),
                  description: t('rerenderHint'),
                  content: <RerenderContractorInvoiceForm id={inv.id} />,
                },
              },
              'separator',
              inv.status === 'issued' && {
                label: `${t('void')}…`,
                destructive: true,
                dialog: { title: t('void'), content: <VoidContractorInvoiceForm id={inv.id} /> },
              },
            ]}
          />
        </PageHeader>
        {inv.status !== 'void' && (
          <Steps
            label={t('v2.flowLabel')}
            current={draft ? 0 : !signed ? 1 : paid ? 3 : 2}
            steps={[t('v2.steps.document'), t('v2.steps.signature'), t('v2.steps.payment')]}
          />
        )}
        <CardLayout
          main={
            <>
              {draft && (
                <Panel
                  title={t('issueTitle')}
                  help={t('draftHint')}
                  helpLabel={tc('help')}
                  emphasis
                >
                  <ContractorInvoiceDraftForm
                    id={inv.id}
                    invoiceDate={inv.invoiceDate}
                    descriptionEn={inv.descriptionEn}
                    descriptionUa={inv.descriptionUa}
                  />
                  <IssueContractorInvoiceForm
                    id={inv.id}
                    number={contractorInvoiceNumber(inv.invoiceDate as LocalDate, [])}
                  />
                </Panel>
              )}
              {inv.status === 'issued' && (
                <Panel title={t('fileTitle')} emphasis={!signed}>
                  {inv.documentId && inv.pdfFileId ? (
                    <Link
                      className="text-link hover:underline"
                      href={`/documents/${inv.documentId}`}
                    >
                      {t('openDocument')}
                    </Link>
                  ) : (
                    <p className="text-muted-foreground">
                      {rendering && <AutoRefresh />}
                      {t('fileRendering')}
                    </p>
                  )}
                  {signed && inv.signedAt ? (
                    <p data-testid="contractor-invoice-signed">
                      {t('signedOn', { date: fmt.date(inv.signedAt.toISOString().slice(0, 10)) })}
                      {inv.signedUrl && (
                        <>
                          {' · '}
                          <a
                            className="text-link hover:underline"
                            href={inv.signedUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('signedLink')}
                          </a>
                        </>
                      )}
                      {inv.signedDocumentId && (
                        <>
                          {' · '}
                          <Link
                            className="text-link hover:underline"
                            href={`/documents/${inv.signedDocumentId}`}
                          >
                            {t('signedCopy')}
                          </Link>
                        </>
                      )}
                    </p>
                  ) : (
                    <>
                      <p className="text-muted-foreground">{t('signHint')}</p>
                      <SignContractorInvoiceForm id={inv.id} />
                    </>
                  )}
                </Panel>
              )}
              {inv.status === 'issued' && signed && payout && (
                <Panel
                  title={t('v2.paymentTitle')}
                  emphasis={!paid}
                  action={
                    <Button
                      size="sm"
                      variant={paid ? 'outline' : 'default'}
                      render={<Link href={payHref ?? '/payroll'} />}
                    >
                      {paid ? t('v2.openPayout') : t('v2.pay')}
                    </Button>
                  }
                >
                  <div data-testid="contractor-invoice-payment" className="flex flex-col gap-2">
                    {payout.payments.length > 0 && (
                      <Status tone={paid ? 'success' : 'warning'}>
                        {paid ? t('v2.paid') : t('v2.partlyPaid')}
                      </Status>
                    )}
                    {payout.payments.map((pm) => (
                      <Link
                        key={`${pm.transactionId}-${pm.amount}`}
                        className="text-link hover:underline"
                        href={`/ledger/${pm.transactionId}/edit`}
                      >
                        {fmt.date(pm.occurredOn)} · {fmt.amount(pm.amount, pm.currency)}
                      </Link>
                    ))}
                    {!paid && <p className="text-muted-foreground">{t('v2.unpaidHint')}</p>}
                  </div>
                </Panel>
              )}
              <AuditHistory ctx={ctx} tableName="contractor_invoice" rowId={inv.id} />
            </>
          }
          aside={
            <Panel>
              <Facts>
                <Fact label={t('date')}>{fmt.date(inv.invoiceDate)}</Fact>
                <Fact label={t('period')}>
                  {inv.periodFrom && inv.periodTo
                    ? `${fmt.date(inv.periodFrom)} – ${fmt.date(inv.periodTo)}`
                    : '—'}
                </Fact>
                <Fact label={t('hours')}>{inv.hours ?? '—'}</Fact>
                <FactsRule />
                <Fact label={t('amount')} strong>
                  <span data-testid="contractor-invoice-amount">
                    {fmt.amount(inv.amount, inv.currency)}
                  </span>
                </Fact>
              </Facts>
              <p className="text-muted-foreground">
                {inv.descriptionEn}
                {inv.descriptionUa !== inv.descriptionEn && ` / ${inv.descriptionUa}`}
              </p>
              {inv.voidReason && <p>{t('voidReasonShown', { reason: inv.voidReason })}</p>}
            </Panel>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          {t('back')}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {inv.number ? t('titleNumber', { number: inv.number }) : t('titleDraft')}
          <Badge variant={draft ? 'outline' : 'secondary'}>
            {DOC_STATUS_LABELS[inv.status] ?? inv.status}
          </Badge>
        </h1>
        <p className="text-muted-foreground">
          {t('subtitle', { payee: payeeName, contract: contractNumber })}
          {personName && month && ` · ${personName} · ${fmt.month(month)}`}
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">{t('date')}</div>
            {fmt.date(inv.invoiceDate)}
          </div>
          <div>
            <div className="text-muted-foreground">{t('period')}</div>
            {inv.periodFrom && inv.periodTo
              ? `${fmt.date(inv.periodFrom)}–${fmt.date(inv.periodTo)}`
              : '—'}
          </div>
          <div>
            <div className="text-muted-foreground">{t('hours')}</div>
            {inv.hours ?? '—'}
          </div>
          <div>
            <div className="text-muted-foreground">{t('amount')}</div>
            <span data-testid="contractor-invoice-amount">
              {fmt.amount(inv.amount, inv.currency)}
            </span>
          </div>
          <div className="sm:col-span-4">
            {inv.descriptionEn} / {inv.descriptionUa}
          </div>
          {inv.voidReason && (
            <div className="sm:col-span-4">{t('voidReasonShown', { reason: inv.voidReason })}</div>
          )}
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('issueTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t('draftHint')}</p>
            <ContractorInvoiceDraftForm
              id={inv.id}
              invoiceDate={inv.invoiceDate}
              descriptionEn={inv.descriptionEn}
              descriptionUa={inv.descriptionUa}
            />
            <IssueContractorInvoiceForm
              id={inv.id}
              number={contractorInvoiceNumber(inv.invoiceDate as LocalDate, [])}
            />
            <DeleteContractorInvoiceForm id={inv.id} />
          </CardContent>
        </Card>
      )}

      {inv.status === 'issued' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('fileTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {inv.documentId && inv.pdfFileId ? (
              <Link className="hover:underline" href={`/documents/${inv.documentId}`}>
                {t('openDocument')}
              </Link>
            ) : (
              <p className="text-muted-foreground">{t('fileRendering')}</p>
            )}
            {rendering && <AutoRefresh />}
            {inv.signedAt ? (
              <p data-testid="contractor-invoice-signed">
                {t('signedOn', { date: fmt.date(inv.signedAt.toISOString().slice(0, 10)) })}
                {inv.signedUrl && (
                  <>
                    {' · '}
                    <a
                      className="hover:underline"
                      href={inv.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('signedLink')}
                    </a>
                  </>
                )}
                {inv.signedDocumentId && (
                  <>
                    {' · '}
                    <Link className="hover:underline" href={`/documents/${inv.signedDocumentId}`}>
                      {t('signedCopy')}
                    </Link>
                  </>
                )}
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">{t('signHint')}</p>
                <SignContractorInvoiceForm id={inv.id} />
              </>
            )}
            <p className="text-muted-foreground">{t('rerenderHint')}</p>
            <RerenderContractorInvoiceForm id={inv.id} />
            <VoidContractorInvoiceForm id={inv.id} />
          </CardContent>
        </Card>
      )}

      <AuditHistory ctx={ctx} tableName="contractor_invoice" rowId={inv.id} />
    </div>
  );
}
