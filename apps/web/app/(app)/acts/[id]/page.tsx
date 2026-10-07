import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getAct } from '@/server/services/acts';
import { ActDraftForm, IssueActForm, SignedUrlForm, VoidActForm } from '../act-forms';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('act');

export default async function ActPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getAct.run(ctx, { id });
  if (result.isErr()) notFound();
  const { act: a, payeeName, contract } = result.value;
  const draft = a.status === 'draft';
  const [t, fmt, { DOC_STATUS_LABELS }] = await Promise.all([
    getTranslations('act'),
    getFormat(),
    getLabels(),
  ]);

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

      {a.status === 'issued' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('signVoid')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {a.pdfFileId ? t('fileReady') : t('fileRendering')}
            </p>
            <SignedUrlForm id={a.id} value={a.signedUrl} />
            <VoidActForm id={a.id} />
          </CardContent>
        </Card>
      )}

      <LinkedDocuments ctx={ctx} entityType="supplier_act" entityId={a.id} />
      <AuditHistory ctx={ctx} tableName="supplier_act" rowId={a.id} />
    </div>
  );
}
