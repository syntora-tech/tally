import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
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

export const generateMetadata = pageTitle('person');

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2">{children}</dd>
    </div>
  );
}

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
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
  const [t, tc, fmt, { ALLOCATION_LABELS, BENCH_LABELS, PERSON_STATUS_LABELS }] = await Promise.all(
    [getTranslations('personCard'), getTranslations('common'), getFormat(), getLabels()],
  );

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
