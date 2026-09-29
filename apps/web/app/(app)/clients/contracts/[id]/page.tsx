import { formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { describeRule } from '@/lib/contract-rules';
import { CONTRACT_KIND_LABELS, CONTRACT_STATUS_LABELS } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getContract } from '@/server/services/clients';

export const metadata: Metadata = { title: 'Договір · Tally' };

const FIELD_LABELS: Record<string, string> = {
  number: 'Номер',
  signed_on: 'Дата підписання',
  currency: 'Валюта',
  payment_due_rule: 'Строк оплати',
  invoice_date_rule: 'Дата інвойсу',
  act_date_rule: 'Дата акту',
  invoice_template_file_id: 'Шаблон інвойсу',
  act_template_file_id: 'Шаблон акту',
  number_sequence_key: 'Послідовність номерів',
  status: 'Статус',
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-all">{value ?? '—'}</dd>
    </div>
  );
}

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getContract.run(ctx, { id });
  if (result.isErr()) notFound();
  const { contract: c, clientName, payeeName, companyName } = result.value;
  const isClient = c.kind === 'client';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Договір {c.number}</h1>
          <p className="text-muted-foreground">
            {CONTRACT_KIND_LABELS[c.kind]} ·{' '}
            {isClient ? (
              <Link className="hover:underline" href={`/clients/${c.clientId ?? ''}`}>
                {clientName}
              </Link>
            ) : (
              <Link className="hover:underline" href={`/people/payees/${c.payeeId ?? ''}`}>
                {payeeName}
              </Link>
            )}
          </p>
        </div>
        <Button variant="outline" render={<Link href={`/clients/contracts/${c.id}/edit`} />}>
          Редагувати
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Умови</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label="Наша сторона" value={companyName} />
              <Row
                label="Дата підписання"
                value={c.signedOn ? formatUaDate(c.signedOn as LocalDate) : null}
              />
              <Row label="Валюта" value={c.currency} />
              <Row label="Статус" value={CONTRACT_STATUS_LABELS[c.status]} />
              {isClient && (
                <Row label="Строк оплати" value={describeRule('payment', c.paymentDueRule)} />
              )}
              {isClient && (
                <Row label="Дата інвойсу" value={describeRule('invoice', c.invoiceDateRule)} />
              )}
              <Row label="Дата акту" value={describeRule('act', c.actDateRule)} />
              {isClient && <Row label="Шаблон інвойсу" value={c.invoiceTemplateFileId} />}
              <Row label="Шаблон акту" value={c.actTemplateFileId} />
              <Row label="Послідовність номерів" value={c.numberSequenceKey} />
            </dl>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <LinkedDocuments ctx={ctx} entityType="contract" entityId={c.id} />
          <AuditHistory ctx={ctx} tableName="contract" rowId={c.id} fieldLabels={FIELD_LABELS} />
        </div>
      </div>
    </div>
  );
}
