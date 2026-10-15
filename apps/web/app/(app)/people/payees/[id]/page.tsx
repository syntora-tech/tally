import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { CounterpartyDossier } from '@/components/counterparty-dossier';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { feeLabel } from '@/lib/fee-label';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listPayeeContracts } from '@/server/services/clients';
import { getPayee } from '@/server/services/payees';
import { getTranslations } from 'next-intl/server';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { CardLayout, KeyValue, KeyValues, Panel } from '@/components/v2/panel';
import { Status } from '@/components/v2/status';

export const generateMetadata = pageTitle('payee');

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-all">{value ?? '—'}</dd>
    </div>
  );
}

export default async function PayeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getPayee.run(ctx, { id });
  if (result.isErr()) notFound();
  const { payee: p, personName } = result.value;
  const contracts = (await listPayeeContracts.run(ctx, { payeeId: p.id })).unwrapOr([]);
  const [t, tc, fmt, { CONTRACT_STATUS_LABELS, PAYEE_KIND_LABELS }] = await Promise.all([
    getTranslations('payees.card'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);

  const v2 = (await getUiPrefs()).version === 'v2';
  if (v2) {
    const tp = await getTranslations('payees');
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title={p.legalNameUa ?? p.legalNameEn}
          crumbParents={[{ label: tp('title'), href: '/people/payees' }]}
          meta={PAYEE_KIND_LABELS[p.kind]}
        >
          <Button variant="outline" render={<Link href={`/people/payees/${p.id}/edit`} />}>
            {tc('edit')}
          </Button>
          <Button render={<Link href={`/clients/contracts/new?payeeId=${p.id}`} />}>
            + {t('newContract')}
          </Button>
        </PageHeader>
        <CardLayout
          main={
            <>
              <Panel title={t('details')}>
                <KeyValues>
                  <KeyValue label={t('nameEn')}>{p.legalNameEn}</KeyValue>
                  <KeyValue label={t('person')}>
                    {personName && p.personId ? (
                      <Link className="text-link hover:underline" href={`/people/${p.personId}`}>
                        {personName}
                      </Link>
                    ) : null}
                  </KeyValue>
                  <KeyValue label={t('taxId')}>{p.taxId}</KeyValue>
                  <KeyValue label={t('edr')}>
                    {p.edrRecord && p.edrDate
                      ? t('edrOf', { record: p.edrRecord, date: fmt.date(p.edrDate) })
                      : (p.edrRecord ?? (p.edrDate ? fmt.date(p.edrDate) : null))}
                  </KeyValue>
                  <KeyValue label={t('address')}>{p.addressUa}</KeyValue>
                  {p.addressEn && <KeyValue label={t('addressEn')}>{p.addressEn}</KeyValue>}
                  {p.bankDetailsEn && (
                    <KeyValue label={t('bankDetailsEn')}>
                      <span className="whitespace-pre-line">{p.bankDetailsEn}</span>
                    </KeyValue>
                  )}
                  <KeyValue label="IBAN">{p.iban}</KeyValue>
                  <KeyValue label={t('bank')}>{p.bankName}</KeyValue>
                  <KeyValue label={t('fee')}>{feeLabel(p, fmt, p.feeCurrency ?? 'UAH')}</KeyValue>
                  <KeyValue label={t('wallet')}>
                    {[p.walletAddress, p.walletNetwork].filter(Boolean).join(' · ') || null}
                  </KeyValue>
                </KeyValues>
              </Panel>
              <CounterpartyDossier ctx={ctx} party="payee" id={p.id} canAdd />
              <AuditHistory ctx={ctx} tableName="payee" rowId={p.id} />
            </>
          }
          aside={
            <Panel title={t('contracts')}>
              {contracts.length === 0 ? (
                <p className="text-muted-foreground">{t('noContracts')}</p>
              ) : (
                <ul className="-mx-5 -mb-4 flex flex-col divide-y border-t">
                  {contracts.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/clients/contracts/${c.id}`}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-3 hover:bg-muted/40"
                      >
                        <span className="font-medium">{c.number}</span>
                        <Status tone={c.status === 'active' ? 'success' : 'neutral'}>
                          {CONTRACT_STATUS_LABELS[c.status]}
                        </Status>
                        {c.signedOn && (
                          <span className="text-xs text-muted-foreground">
                            {fmt.date(c.signedOn)}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{p.legalNameUa ?? p.legalNameEn}</h1>
          <p className="text-muted-foreground">{PAYEE_KIND_LABELS[p.kind]}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" render={<Link href={`/people/payees/${p.id}/edit`} />}>
            {tc('edit')}
          </Button>
          <Button render={<Link href={`/clients/contracts/new?payeeId=${p.id}`} />}>
            {t('newContract')}
          </Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label={t('nameEn')} value={p.legalNameEn} />
              <Row
                label={t('person')}
                value={
                  personName && p.personId ? (
                    <Link className="hover:underline" href={`/people/${p.personId}`}>
                      {personName}
                    </Link>
                  ) : null
                }
              />
              <Row label={t('taxId')} value={p.taxId} />
              <Row
                label={t('edr')}
                value={
                  p.edrRecord && p.edrDate
                    ? t('edrOf', { record: p.edrRecord, date: fmt.date(p.edrDate) })
                    : (p.edrRecord ?? (p.edrDate ? fmt.date(p.edrDate) : null))
                }
              />
              <Row label={t('address')} value={p.addressUa} />
              {p.addressEn && <Row label={t('addressEn')} value={p.addressEn} />}
              {p.bankDetailsEn && (
                <Row
                  label={t('bankDetailsEn')}
                  value={<span className="whitespace-pre-line">{p.bankDetailsEn}</span>}
                />
              )}
              <Row label="IBAN" value={p.iban} />
              <Row label={t('bank')} value={p.bankName} />
              <Row label={t('fee')} value={feeLabel(p, fmt, p.feeCurrency ?? 'UAH')} />
              <Row
                label={t('wallet')}
                value={[p.walletAddress, p.walletNetwork].filter(Boolean).join(' · ') || null}
              />
            </dl>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('contracts')}</CardTitle>
            </CardHeader>
            <CardContent>
              {contracts.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noContracts')}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {contracts.map((c) => (
                    <li key={c.id}>
                      <Link
                        className="font-medium hover:underline"
                        href={`/clients/contracts/${c.id}`}
                      >
                        {c.number}
                      </Link>
                      {c.signedOn && (
                        <span className="text-muted-foreground">
                          {t('of', { date: fmt.date(c.signedOn) })}
                        </span>
                      )}
                      {c.status !== 'active' && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {CONTRACT_STATUS_LABELS[c.status]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <CounterpartyDossier ctx={ctx} party="payee" id={p.id} canAdd />
          <AuditHistory ctx={ctx} tableName="payee" rowId={p.id} />
        </div>
      </div>
    </div>
  );
}
