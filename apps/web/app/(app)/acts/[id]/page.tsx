import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { AutoRefresh } from '@/components/auto-refresh';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getAct, renderActJob } from '@/server/services/acts';
import { jobPending } from '@/server/services/settings';
import {
  ActDraftForm,
  DeleteDraftActForm,
  IssueActForm,
  MergeTripActsForm,
  OwnDocumentActForm,
  SignedFileForm,
  SignedUrlForm,
  VoidActForm,
} from '../act-forms';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { RowMenu } from '@/components/v2/form-dialog';
import { PageHeader } from '@/components/v2/page-header';
import { CardLayout, Fact, Facts, FactsRule, Panel } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';
import { Steps } from '@/components/v2/steps';
import { TabsNav } from '@/components/v2/tabs-nav';
import { getUiPrefs } from '@/server/ui-prefs';

export const generateMetadata = pageTitle('act');

export default async function ActPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getAct.run(ctx, { id });
  if (result.isErr()) notFound();
  const { act: a, payeeName, contract, nextNumber, trips, mergeable } = result.value;
  const draft = a.status === 'draft';
  const uploaded =
    typeof a.snapshot === 'object' && a.snapshot !== null && 'uploaded' in a.snapshot;
  const rendering =
    a.status === 'issued' &&
    !a.pdfFileId &&
    (await jobPending.run(ctx, { dedupeKeys: [renderActJob(a.id).dedupeKey ?? ''] })).unwrapOr(
      false,
    );
  const [t, tf, fmt, { DOC_STATUS_LABELS }] = await Promise.all([
    getTranslations('act'),
    getTranslations('actForms'),
    getFormat(),
    getLabels(),
  ]);

  if ((await getUiPrefs()).version === 'v2') {
    const [tv, tc, tp] = await Promise.all([
      getTranslations('act.v2'),
      getTranslations('common'),
      getTranslations('payroll.v2'),
    ]);
    const own = (await searchParams).mode === 'own';
    const signed = !!a.signedUrl || !!a.signedDocumentId;
    const deletable = draft && ctx.actor.role === 'owner' && trips.length === 0 && !a.rateLocked;
    const tone = draft
      ? 'neutral'
      : a.status === 'void'
        ? 'danger'
        : signed
          ? 'success'
          : 'warning';
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={a.number ? t('titleNumber', { number: a.number }) : t('titleDraft')}
          crumb={a.number ?? t('titleDraft')}
          badges={
            <Status tone={tone} testId="act-status">
              {DOC_STATUS_LABELS[a.status] ?? a.status}
            </Status>
          }
          meta={`${payeeName} · ${contract.number}`}
        >
          <RowMenu
            label={tc('actions')}
            entries={[
              deletable && {
                label: tv('deleteAction'),
                destructive: true,
                dialog: {
                  title: t('deleteTitle'),
                  content: (
                    <DeleteDraftActForm
                      id={a.id}
                      partOfMonth={
                        a.type === 'monthly' && (a.amountUsd !== null || !!a.payrollItemId)
                      }
                    />
                  ),
                },
              },
              mergeable.length > 0 && {
                label: tf('v2.mergeTrips') + '…',
                dialog: {
                  title: tf('v2.mergeTrips'),
                  content: (
                    <MergeTripActsForm
                      id={a.id}
                      others={mergeable.map((m) => ({
                        id: m.id,
                        label: [
                          m.periodFrom && m.periodTo
                            ? `${fmt.date(m.periodFrom)} – ${fmt.date(m.periodTo)}`
                            : fmt.date(m.actDate),
                          fmt.amount(m.amountUah, 'UAH'),
                        ].join(' · '),
                      }))}
                    />
                  ),
                },
              },
              a.status === 'issued' && {
                label: tv('voidAction'),
                destructive: true,
                dialog: { title: tf('void'), content: <VoidActForm id={a.id} /> },
              },
            ]}
          />
        </PageHeader>
        {a.status !== 'void' && (
          <Steps
            label={tp('stepsLabel')}
            current={draft ? 0 : signed ? 2 : 1}
            steps={[tp('steps.document'), tp('steps.signature'), tp('steps.payment')]}
          />
        )}
        <CardLayout
          main={
            <>
              {draft && (
                <Panel
                  title={tv('issueTitle')}
                  emphasis
                  action={
                    <TabsNav
                      segmented
                      label={tv('issueMode')}
                      active={own ? 'own' : 'generate'}
                      tabs={[
                        { key: 'generate', label: tv('generate'), href: `/acts/${a.id}` },
                        { key: 'own', label: tv('own'), href: `/acts/${a.id}?mode=own` },
                      ]}
                    />
                  }
                >
                  {own ? (
                    <>
                      <p className="text-muted-foreground">{tf('ownHint')}</p>
                      <OwnDocumentActForm id={a.id} actDate={a.actDate} />
                    </>
                  ) : (
                    <>
                      <ActDraftForm
                        id={a.id}
                        actDate={a.actDate}
                        periodFrom={a.periodFrom}
                        periodTo={a.periodTo}
                        amountUah={a.amountUah}
                        editableAmount={a.type !== 'monthly'}
                        dateOverrideReason={a.dateOverrideReason}
                      />
                      <IssueActForm id={a.id} nextNumber={nextNumber} />
                    </>
                  )}
                </Panel>
              )}
              {a.status === 'issued' && (
                <Panel title={tv('signTitle')} emphasis={!signed}>
                  <p className="text-muted-foreground">
                    {rendering && <AutoRefresh />}
                    {a.pdfFileId ? (uploaded ? t('fileOwn') : t('fileReady')) : t('fileRendering')}
                  </p>
                  <SignedUrlForm id={a.id} value={a.signedUrl} />
                  {a.signedDocumentId ? <p>{t('signedDocument')}</p> : <SignedFileForm id={a.id} />}
                </Panel>
              )}
              <AuditHistory ctx={ctx} tableName="supplier_act" rowId={a.id} />
            </>
          }
          aside={
            <>
              <Panel>
                <Facts>
                  <Fact label={tv('payee')}>
                    <Link
                      href={`/people/payees/${a.payeeId}`}
                      className="text-link hover:underline"
                    >
                      {payeeName}
                    </Link>
                  </Fact>
                  <Fact label={tv('contract')}>
                    <Link
                      href={`/clients/contracts/${contract.id}`}
                      className="text-link hover:underline"
                    >
                      {contract.number}
                    </Link>
                  </Fact>
                  {trips.length > 0 && (
                    <Fact label={tf('v2.trips')}>
                      <span className="flex flex-col items-end">
                        {trips.map((x) => (
                          <Link
                            key={x.reimbursementId}
                            href={`/trips/${x.tripId}`}
                            className="text-link hover:underline"
                          >
                            {x.title}
                          </Link>
                        ))}
                      </span>
                    </Fact>
                  )}
                  <Fact label={t('date')}>{fmt.date(a.actDate)}</Fact>
                  <Fact label={t('period')}>
                    {a.periodFrom && a.periodTo
                      ? `${fmt.date(a.periodFrom)} – ${fmt.date(a.periodTo)}`
                      : '—'}
                  </Fact>
                  <FactsRule />
                  <Fact label={t('amount')} strong>
                    <span data-testid="act-amount">{fmt.amount(a.amountUah, 'UAH')}</span>
                  </Fact>
                </Facts>
                {a.voidReason && <p>{t('voidReason', { reason: a.voidReason })}</p>}
              </Panel>
              {a.status !== 'void' && !signed && (
                <Panel title={tv('nextTitle')}>
                  <ol className="flex flex-col gap-2.5">
                    {[
                      tv('nextSign'),
                      a.payrollItemId ? (
                        <Link key="pay" href="/payroll" className="text-link hover:underline">
                          {tv('nextPay')}
                        </Link>
                      ) : (
                        tv('nextPay')
                      ),
                    ].map((step, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </Panel>
              )}
              <LinkedDocuments ctx={ctx} entityType="supplier_act" entityId={a.id} />
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/acts" className="text-sm text-muted-foreground hover:underline">
          {t('back')}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {a.number ? t('titleNumber', { number: a.number }) : t('titleDraft')}
          <Badge variant={draft ? 'outline' : 'secondary'}>
            {DOC_STATUS_LABELS[a.status] ?? a.status}
          </Badge>
        </h1>
        <p className="text-muted-foreground">
          {t('contract', { payee: payeeName, number: contract.number })}
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">{t('date')}</div>
            {fmt.date(a.actDate)}
          </div>
          <div>
            <div className="text-muted-foreground">{t('period')}</div>
            {a.periodFrom && a.periodTo
              ? t('periodRange', { from: fmt.date(a.periodFrom), to: fmt.date(a.periodTo) })
              : '—'}
          </div>
          <div>
            <div className="text-muted-foreground">{t('amount')}</div>
            <span data-testid="act-amount">{fmt.amount(a.amountUah, 'UAH')}</span>
          </div>
          {a.voidReason && (
            <div className="sm:col-span-3">{t('voidReason', { reason: a.voidReason })}</div>
          )}
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('issue')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ActDraftForm
              id={a.id}
              actDate={a.actDate}
              amountUah={a.amountUah}
              editableAmount={a.type !== 'monthly'}
              dateOverrideReason={a.dateOverrideReason}
            />
            <IssueActForm id={a.id} />
          </CardContent>
        </Card>
      )}

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{tf('ownTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <OwnDocumentActForm id={a.id} actDate={a.actDate} />
          </CardContent>
        </Card>
      )}

      {draft && ctx.actor.role === 'owner' && trips.length === 0 && !a.rateLocked && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('deleteTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteDraftActForm
              id={a.id}
              partOfMonth={a.type === 'monthly' && (a.amountUsd !== null || !!a.payrollItemId)}
            />
          </CardContent>
        </Card>
      )}

      {a.status === 'issued' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('signVoid')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {a.pdfFileId ? (uploaded ? t('fileOwn') : t('fileReady')) : t('fileRendering')}
            </p>
            {rendering && <AutoRefresh />}
            <SignedUrlForm id={a.id} value={a.signedUrl} />
            {a.signedDocumentId ? (
              <p className="text-sm">{t('signedDocument')}</p>
            ) : (
              <SignedFileForm id={a.id} />
            )}
            <VoidActForm id={a.id} />
          </CardContent>
        </Card>
      )}

      <LinkedDocuments ctx={ctx} entityType="supplier_act" entityId={a.id} />
      <AuditHistory ctx={ctx} tableName="supplier_act" rowId={a.id} />
    </div>
  );
}
