import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { PayoutChargesCard } from '@/components/payout-charges-card';
import { WalletsCard } from '@/components/wallets-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPerson } from '@/server/services/people';
import { listPayees } from '@/server/services/payees';
import { AssignmentsCard } from './assignments-card';
import { CvUpload } from './cv-upload';
import { DefaultPayeeForm } from './default-payee-form';
import { getTranslations } from 'next-intl/server';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { DialogButton, RowMenu } from '@/components/v2/form-dialog';
import { PageHeader } from '@/components/v2/page-header';
import { KeyValue, KeyValues, Panel } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';
import { TabsNav } from '@/components/v2/tabs-nav';
import { getUiPrefs } from '@/server/ui-prefs';

export const generateMetadata = pageTitle('person');

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2">{children}</dd>
    </div>
  );
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRole(ALL_ROLES);
  const { id } = await params;
  const result = await getPerson.run(ctx, { id });
  if (result.isErr()) notFound();
  const p = result.value;
  const isFinance = FINANCE_ROLES.includes(ctx.actor.role);
  const payees = isFinance ? await listPayees.run(ctx, {}) : null;
  const payeeOptions = payees?.isOk()
    ? payees.value.map((py) => ({ value: py.id, label: py.name }))
    : [];
  const [t, tc, fmt, { ALLOCATION_LABELS, BENCH_LABELS, PAYEE_KIND_LABELS, PERSON_STATUS_LABELS }] =
    await Promise.all([
      getTranslations('personCard'),
      getTranslations('common'),
      getFormat(),
      getLabels(),
    ]);

  if ((await getUiPrefs()).version === 'v2') {
    const tv = await getTranslations('personCard.v2');
    const requested = (await searchParams).tab;
    const tabs: ('overview' | 'money' | 'documents' | 'history')[] = [
      'overview',
      ...(isFinance ? (['money'] as const) : []),
      'documents',
      'history',
    ];
    const tab = (tabs as readonly string[]).includes(requested as string)
      ? (requested as string)
      : 'overview';
    const initials = p.fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
    const current = payees?.isOk()
      ? payees.value.find((py) => py.id === p.defaultPayee?.id)
      : undefined;
    const payeeForm = (
      <DefaultPayeeForm
        personId={p.id}
        currentPayeeId={p.defaultPayee?.id ?? null}
        options={payeeOptions}
      />
    );
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-success font-heading text-lg font-bold text-success-foreground">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <PageHeader
              title={p.fullName}
              meta={
                <span className="flex flex-wrap items-center gap-2">
                  {[p.position ?? t('noPosition'), p.seniority.join(', ')]
                    .filter(Boolean)
                    .join(' · ')}
                  <Status tone={p.status === 'active' ? 'success' : 'neutral'}>
                    {PERSON_STATUS_LABELS[p.status]}
                  </Status>
                  <Status
                    tone={p.bench === 'free' ? 'success' : p.bench === 'busy' ? 'neutral' : 'info'}
                  >
                    {BENCH_LABELS[p.bench]} · FTE {p.load}
                  </Status>
                </span>
              }
            >
              {isFinance && (
                <>
                  <RowMenu
                    label={tc('actions')}
                    entries={[{ label: tv('editProfile'), href: `/people/${p.id}/edit` }]}
                  />
                  <Button render={<Link href={`/people/${p.id}/assignments/new`} />}>
                    + {tv('newAssignment')}
                  </Button>
                </>
              )}
            </PageHeader>
          </div>
        </div>
        <TabsNav
          label={p.fullName}
          active={tab}
          tabs={tabs.map((k) => ({
            key: k,
            label: tv(`tabs.${k}`),
            href: `/people/${p.id}?tab=${k}`,
          }))}
        />
        {tab === 'overview' && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            <Panel title={t('profile')}>
              <KeyValues>
                <KeyValue label={t('stack')}>
                  {p.stack.length ? (
                    <span className="flex flex-wrap gap-1">
                      {p.stack.map((tag) => (
                        <span key={tag} className="rounded bg-muted px-2 py-0.5 text-xs">
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </KeyValue>
                <KeyValue label={t('domains')}>{p.domains.join(', ') || null}</KeyValue>
                <KeyValue label={t('marketRate')}>
                  {p.marketRateUsd ? t('perHour', { amount: fmt.amount(p.marketRateUsd) }) : null}
                </KeyValue>
                <KeyValue label={t('allocation')}>
                  {p.allocation ? ALLOCATION_LABELS[p.allocation] : null}
                </KeyValue>
                <KeyValue label={t('availableFrom')}>
                  {p.availabilityFrom ? fmt.date(p.availabilityFrom) : t('now')}
                </KeyValue>
                <KeyValue label={t('location')}>
                  {[p.location, p.timezone].filter(Boolean).join(', ') || null}
                </KeyValue>
                <KeyValue label={t('contactOwner')}>{p.contactOwner}</KeyValue>
                {p.notes && (
                  <KeyValue label={t('notes')}>
                    <span className="whitespace-pre-line">{p.notes}</span>
                  </KeyValue>
                )}
              </KeyValues>
            </Panel>
            <div className="flex flex-col gap-5">
              {isFinance && <AssignmentsCard ctx={ctx} personId={p.id} />}
              {isFinance && (
                <Panel
                  title={t('payee')}
                  action={
                    <DialogButton variant="outline" title={t('payee')} content={payeeForm}>
                      {p.defaultPayee ? tv('changePayee') : tv('choosePayee')}
                    </DialogButton>
                  }
                >
                  {p.defaultPayee ? (
                    <KeyValues>
                      <KeyValue label={tv('payeeWho')}>
                        <Link
                          href={`/people/payees/${p.defaultPayee.id}`}
                          className="text-link hover:underline"
                        >
                          {p.defaultPayee.name}
                        </Link>
                      </KeyValue>
                      {current && (
                        <KeyValue label={tv('payeeKind')}>
                          {PAYEE_KIND_LABELS[current.kind]}
                        </KeyValue>
                      )}
                    </KeyValues>
                  ) : (
                    <p className="text-muted-foreground">{tv('noPayee')}</p>
                  )}
                </Panel>
              )}
            </div>
          </div>
        )}
        {tab === 'money' && isFinance && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            <WalletsCard ctx={ctx} owner={{ name: 'personId', value: p.id }} />
            <PayoutChargesCard ctx={ctx} personId={p.id} />
          </div>
        )}
        {tab === 'documents' && (
          <LinkedDocuments
            ctx={ctx}
            entityType="person"
            entityId={p.id}
            canAdd={isFinance}
            action={isFinance ? <CvUpload personId={p.id} /> : undefined}
          />
        )}
        {tab === 'history' && <AuditHistory ctx={ctx} tableName="person" rowId={p.id} open />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{p.fullName}</h1>
          <p className="text-muted-foreground">{p.position ?? t('noPosition')}</p>
        </div>
        {isFinance && (
          <Button variant="outline" render={<Link href={`/people/${p.id}/edit`} />}>
            {tc('edit')}
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('profile')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label={t('bench')}>
                <Badge variant="secondary">{BENCH_LABELS[p.bench]}</Badge>{' '}
                <span className="text-muted-foreground">FTE {p.load}</span>
              </Row>
              <Row label={t('status')}>{PERSON_STATUS_LABELS[p.status]}</Row>
              <Row label={t('seniority')}>{p.seniority.join(', ') || '—'}</Row>
              <Row label={t('stack')}>
                <div className="flex flex-wrap gap-1">
                  {p.stack.length
                    ? p.stack.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))
                    : '—'}
                </div>
              </Row>
              <Row label={t('domains')}>{p.domains.join(', ') || '—'}</Row>
              <Row label={t('marketRate')}>
                {p.marketRateUsd ? t('perHour', { amount: fmt.amount(p.marketRateUsd) }) : '—'}
              </Row>
              <Row label={t('allocation')}>
                {p.allocation ? ALLOCATION_LABELS[p.allocation] : '—'}
              </Row>
              <Row label={t('availableFrom')}>
                {p.availabilityFrom ? fmt.date(p.availabilityFrom) : t('now')}
              </Row>
              <Row label={t('location')}>
                {[p.location, p.timezone].filter(Boolean).join(', ') || '—'}
              </Row>
              <Row label={t('contactOwner')}>{p.contactOwner ?? '—'}</Row>
              {isFinance && (
                <Row label={t('payee')}>
                  <DefaultPayeeForm
                    personId={p.id}
                    currentPayeeId={p.defaultPayee?.id ?? null}
                    options={payeeOptions}
                  />
                </Row>
              )}
              {p.notes && <Row label={t('notes')}>{p.notes}</Row>}
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          {isFinance && <AssignmentsCard ctx={ctx} personId={p.id} />}
          {isFinance && <WalletsCard ctx={ctx} owner={{ name: 'personId', value: p.id }} />}
          {isFinance && <PayoutChargesCard ctx={ctx} personId={p.id} />}
          <LinkedDocuments
            ctx={ctx}
            entityType="person"
            entityId={p.id}
            canAdd={isFinance}
            action={isFinance ? <CvUpload personId={p.id} /> : undefined}
          />
          <AuditHistory ctx={ctx} tableName="person" rowId={p.id} />
        </div>
      </div>
    </div>
  );
}
