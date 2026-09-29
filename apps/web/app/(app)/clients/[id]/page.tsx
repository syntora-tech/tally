import { formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CONTRACT_STATUS_LABELS } from '@/lib/labels';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getClient } from '@/server/services/clients';

export const metadata: Metadata = { title: 'Клієнт · Tally' };

const FIELD_LABELS: Record<string, string> = {
  legal_name: 'Юридична назва',
  short_name: 'Коротка назва',
  address: 'Адреса',
  country: 'Країна',
  bank_details: 'Банківські реквізити',
  contacts: 'Контакти',
  default_currency: 'Валюта',
  zoho_id: 'Zoho ID',
};

type Contact = { name: string; role?: string; email?: string; phone?: string };

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(ALL_ROLES);
  const { id } = await params;
  const result = await getClient.run(ctx, { id });
  if (result.isErr()) notFound();
  const { client: c, contracts, activePeople } = result.value;
  const isFinance = FINANCE_ROLES.includes(ctx.actor.role);
  const contacts = c.contacts as Contact[];

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
              Редагувати
            </Button>
            <Button render={<Link href={`/clients/contracts/new?clientId=${c.id}`} />}>
              Новий договір
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Реквізити</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">Адреса</div>
                <p className="whitespace-pre-line">{c.address ?? '—'}</p>
              </div>
              <div>
                <div className="text-muted-foreground">Банківські реквізити</div>
                <p className="whitespace-pre-line">{c.bankDetails ?? '—'}</p>
              </div>
              {c.zohoId && <div className="text-muted-foreground">Zoho ID: {c.zohoId}</div>}
              <div>
                <div className="text-muted-foreground">Контакти</div>
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
                <CardTitle className="text-base">Договори</CardTitle>
              </CardHeader>
              <CardContent>
                {contracts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Договорів ще немає</p>
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
                            від {formatUaDate(ct.signedOn as LocalDate)}
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
                <CardTitle className="text-base">Активні люди</CardTitle>
              </CardHeader>
              <CardContent>
                {activePeople.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Зараз нікого не залучено</p>
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
                <CardTitle className="text-base">Інвойси та дебіторка</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Інвойси, дебіторка й середня затримка оплати з’являться на Етапі 2.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <LinkedDocuments ctx={ctx} entityType="client" entityId={c.id} />
          <AuditHistory ctx={ctx} tableName="client" rowId={c.id} fieldLabels={FIELD_LABELS} />
        </div>
      </div>
    </div>
  );
}
