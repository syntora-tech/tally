import { formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ALLOCATION_LABELS, BENCH_LABELS, PERSON_STATUS_LABELS } from '@/lib/labels';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPerson } from '@/server/services/people';
import { CvUpload } from './cv-upload';

export const metadata: Metadata = { title: 'Людина · Tally' };

const PERSON_FIELD_LABELS: Record<string, string> = {
  full_name: 'Ім’я',
  display_name: 'Коротке ім’я',
  position: 'Позиція',
  seniority: 'Сеньйорність',
  stack: 'Стек',
  domains: 'Домени',
  market_rate_usd: 'Ставка',
  allocation: 'Формат',
  availability_from: 'Доступний з',
  location: 'Локація',
  timezone: 'Часовий пояс',
  contact_owner: 'Контактна особа',
  status: 'Статус',
  default_payee_id: 'Одержувач',
  notes: 'Нотатки',
};

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{p.fullName}</h1>
          <p className="text-muted-foreground">{p.position ?? 'Позиція не вказана'}</p>
        </div>
        {isFinance && (
          <Button variant="outline" render={<Link href={`/people/${p.id}/edit`} />}>
            Редагувати
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Профіль</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Зайнятість">
                <Badge variant="secondary">{BENCH_LABELS[p.bench]}</Badge>{' '}
                <span className="text-muted-foreground">FTE {p.load}</span>
              </Row>
              <Row label="Статус">{PERSON_STATUS_LABELS[p.status]}</Row>
              <Row label="Сеньйорність">{p.seniority.join(', ') || '—'}</Row>
              <Row label="Стек">
                <div className="flex flex-wrap gap-1">
                  {p.stack.length
                    ? p.stack.map((t) => (
                        <Badge key={t} variant="outline">
                          {t}
                        </Badge>
                      ))
                    : '—'}
                </div>
              </Row>
              <Row label="Домени">{p.domains.join(', ') || '—'}</Row>
              <Row label="Ринкова ставка">
                {p.marketRateUsd ? `${formatAmount(p.marketRateUsd)} $/год` : '—'}
              </Row>
              <Row label="Формат">{p.allocation ? ALLOCATION_LABELS[p.allocation] : '—'}</Row>
              <Row label="Доступний з">
                {p.availabilityFrom ? formatUaDate(p.availabilityFrom as LocalDate) : 'зараз'}
              </Row>
              <Row label="Локація">
                {[p.location, p.timezone].filter(Boolean).join(', ') || '—'}
              </Row>
              <Row label="Контактна особа">{p.contactOwner ?? '—'}</Row>
              {isFinance && <Row label="Одержувач виплат">{p.defaultPayee?.name ?? '—'}</Row>}
              {p.notes && <Row label="Нотатки">{p.notes}</Row>}
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <LinkedDocuments
            ctx={ctx}
            entityType="person"
            entityId={p.id}
            action={isFinance ? <CvUpload personId={p.id} /> : undefined}
          />
          <AuditHistory
            ctx={ctx}
            tableName="person"
            rowId={p.id}
            fieldLabels={PERSON_FIELD_LABELS}
          />
        </div>
      </div>
    </div>
  );
}
