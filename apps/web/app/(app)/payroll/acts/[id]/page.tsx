import { formatAmount, formatUaDate, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DOC_STATUS_LABELS } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getAct } from '@/server/services/acts';
import { ActDraftForm, IssueActForm, SignedUrlForm, VoidActForm } from '../act-forms';

export const metadata: Metadata = { title: 'Акт · Tally' };

export default async function ActPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getAct.run(ctx, { id });
  if (result.isErr()) notFound();
  const { act: a, payeeName, contract } = result.value;
  const draft = a.status === 'draft';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/payroll/acts" className="text-sm text-muted-foreground hover:underline">
          ← Реєстр актів
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {a.number ? `Акт № ${a.number}` : 'Чернетка акту'}
          <Badge variant={draft ? 'outline' : 'secondary'}>
            {DOC_STATUS_LABELS[a.status] ?? a.status}
          </Badge>
        </h1>
        <p className="text-muted-foreground">
          {payeeName} · договір {contract.number}
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-3">
          <div>
            <div className="text-muted-foreground">Дата</div>
            {formatUaDate(a.actDate as LocalDate)}
          </div>
          <div>
            <div className="text-muted-foreground">Період</div>
            {a.periodFrom && a.periodTo
              ? `з ${formatUaDate(a.periodFrom as LocalDate)} по ${formatUaDate(a.periodTo as LocalDate)}`
              : '—'}
          </div>
          <div>
            <div className="text-muted-foreground">Сума</div>
            <span data-testid="act-amount">{formatAmount(a.amountUah, 'UAH')}</span>
          </div>
          {a.voidReason && <div className="sm:col-span-3">Причина анулювання: {a.voidReason}</div>}
        </CardContent>
      </Card>

      {draft && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Випуск</CardTitle>
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
            <CardTitle className="text-base">Підписання та анулювання</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {a.pdfFileId ? 'Файл акту згенеровано — він у документах нижче' : 'Файл генерується…'}
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
