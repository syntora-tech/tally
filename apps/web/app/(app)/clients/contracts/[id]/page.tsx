import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getContract } from '@/server/services/clients';
import { getTranslations } from 'next-intl/server';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('contract');

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
  const [t, tc, fmt, { CONTRACT_KIND_LABELS, CONTRACT_STATUS_LABELS }] = await Promise.all([
    getTranslations('contracts'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title', { number: c.number })}</h1>
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
          {tc('edit')}
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('terms')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <Row label={t('ourSide')} value={companyName} />
              <Row label={t('signedOn')} value={c.signedOn ? fmt.date(c.signedOn) : null} />
              <Row label={t('currency')} value={c.currency} />
              <Row label={t('status')} value={CONTRACT_STATUS_LABELS[c.status]} />
              {isClient && (
                <Row label={t('paymentDue')} value={fmt.rule('payment', c.paymentDueRule)} />
              )}
              {isClient && (
                <Row label={t('invoiceDate')} value={fmt.rule('invoice', c.invoiceDateRule)} />
              )}
              <Row label={t('actDate')} value={fmt.rule('act', c.actDateRule)} />
              {isClient && <Row label={t('invoiceTemplate')} value={c.invoiceTemplateFileId} />}
              <Row label={t('actTemplate')} value={c.actTemplateFileId} />
              <Row label={t('sequence')} value={c.numberSequenceKey} />
            </dl>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <LinkedDocuments ctx={ctx} entityType="contract" entityId={c.id} canAdd />
          <AuditHistory ctx={ctx} tableName="contract" rowId={c.id} />
        </div>
      </div>
    </div>
  );
}
