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
import { getClient } from '@/server/services/clients';
import { getTranslations } from 'next-intl/server';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('client');

type Contact = { name: string; role?: string; email?: string; phone?: string };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(ALL_ROLES);
  const { id } = await params;
  const result = await getClient.run(ctx, { id });
  if (result.isErr()) notFound();
  const { client: c, contracts, activePeople } = result.value;
  const isFinance = FINANCE_ROLES.includes(ctx.actor.role);
  const contacts = c.contacts as Contact[];
  const [t, tc, fmt, { CONTRACT_STATUS_LABELS }] = await Promise.all([
    getTranslations('clientCard'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{c.shortName ?? c.legalName}</h1>
          <p className="text-muted-foreground">
            {c.legalName}
            {c.country ? ` · ${c.country}` : ''} · {c.defaultCurrency}
          </p>
        </div>
        {isFinance && (
          <div className="flex gap-2">
            <Button variant="outline" render={<Link href={`/clients/${c.id}/edit`} />}>
              {tc('edit')}
            </Button>
            <Button render={<Link href={`/clients/contracts/new?clientId=${c.id}`} />}>
              {t('newContract')}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('details')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">{t('address')}</div>
                <p className="whitespace-pre-line">{c.address ?? '—'}</p>
              </div>
              <div>
                <div className="text-muted-foreground">{t('bankDetails')}</div>
                <p className="whitespace-pre-line">{c.bankDetails ?? '—'}</p>
              </div>
              <div>
                <div className="text-muted-foreground">{t('contacts')}</div>
                {contacts.length === 0 ? (
                  '—'
                ) : (
                  <ul>
                    {contacts.map((ct, i) => (
                      <li key={i}>
                        {ct.name}
                        {ct.role ? ` (${ct.role})` : ''}
                        {ct.email ? ` · ${ct.email}` : ''}
                        {ct.phone ? ` · ${ct.phone}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {isFinance && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('contracts')}</CardTitle>
              </CardHeader>
              <CardContent>
                {contracts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noContracts')}</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {contracts.map((ct) => (
                      <li key={ct.id} className="flex items-center gap-2">
                        <Link
                          href={`/clients/contracts/${ct.id}`}
                          className="font-medium hover:underline"
                        >
                          {ct.number}
                        </Link>
                        {ct.signedOn && (
                          <span className="text-muted-foreground">
                            {t('signedOn', { date: fmt.date(ct.signedOn) })}
                          </span>
                        )}
                        <Badge variant="outline">{ct.currency}</Badge>
                        {ct.status !== 'active' && (
                          <Badge variant="secondary">{CONTRACT_STATUS_LABELS[ct.status]}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {isFinance && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('activePeople')}</CardTitle>
              </CardHeader>
              <CardContent>
                {activePeople.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('noActivePeople')}</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {activePeople.map((a) => (
                      <li key={a.assignmentId} className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/people/${a.personId}`}
                          className="font-medium hover:underline"
                        >
                          {a.personName}
                        </Link>
                        <span className="text-muted-foreground">
                          {[a.roleTitle, a.sowRef, a.contractNumber].filter(Boolean).join(' · ')}
                        </span>
                        <Badge variant="outline">FTE {a.fte}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {isFinance && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('invoicesTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t('invoicesSoon')}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          {isFinance && <WalletsCard ctx={ctx} owner={{ name: 'clientId', value: c.id }} />}
          <LinkedDocuments ctx={ctx} entityType="client" entityId={c.id} canAdd={isFinance} />
          <AuditHistory ctx={ctx} tableName="client" rowId={c.id} />
        </div>
      </div>
    </div>
  );
}
