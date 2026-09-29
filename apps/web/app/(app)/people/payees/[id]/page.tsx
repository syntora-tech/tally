import { formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PAYEE_KIND_LABELS } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPayee } from '@/server/services/payees';

export const metadata: Metadata = { title: 'Одержувач · Tally' };

const FIELD_LABELS: Record<string, string> = {
  kind: 'Тип',
  legal_name_ua: 'Назва (UA)',
  legal_name_en: 'Назва (EN)',
  tax_id: 'ІПН',
  edr_record: 'Запис ЄДР',
  edr_date: 'Дата ЄДР',
  address_ua: 'Адреса',
  iban: 'IBAN',
  bank_name: 'Банк',
  wallet_address: 'Гаманець',
  wallet_network: 'Мережа',
  person_id: 'Людина',
};

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{p.legalNameUa ?? p.legalNameEn}</h1>
          <p className="text-muted-foreground">{PAYEE_KIND_LABELS[p.kind]}</p>
        </div>
        <Button variant="outline" render={<Link href={`/people/payees/${p.id}/edit`} />}>
          Редагувати
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Реквізити</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Назва (EN)" value={p.legalNameEn} />
              <Row
                label="Людина"
                value={
                  personName && p.personId ? (
                    <Link className="hover:underline" href={`/people/${p.personId}`}>
                      {personName}
                    </Link>
                  ) : null
                }
              />
              <Row label="ІПН / РНОКПП" value={p.taxId} />
              <Row
                label="Запис у ЄДР"
                value={
                  [p.edrRecord, p.edrDate && formatUaDate(p.edrDate as LocalDate)]
                    .filter(Boolean)
                    .join(' від ') || null
                }
              />
              <Row label="Адреса" value={p.addressUa} />
              <Row label="IBAN" value={p.iban} />
              <Row label="Банк" value={p.bankName} />
              <Row
                label="Гаманець"
                value={[p.walletAddress, p.walletNetwork].filter(Boolean).join(' · ') || null}
              />
            </dl>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <LinkedDocuments ctx={ctx} entityType="payee" entityId={p.id} />
          <AuditHistory ctx={ctx} tableName="payee" rowId={p.id} fieldLabels={FIELD_LABELS} />
        </div>
      </div>
    </div>
  );
}
