import { toDecimal } from '@tally/domain';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuditHistory } from '@/components/audit-history';
import { LinkedDocuments } from '@/components/linked-documents';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { invoiceAllocations, paymentCandidates } from '@/server/services/allocations';
import { getInvoice, invoiceRenderStatus, issuePreview } from '@/server/services/invoices';
import {
  AllocatePaymentForm,
  InvoiceEditForm,
  IssueForm,
  RegeneratePdfForm,
  RemoveAllocationButton,
  ReissueForm,
  SignedCopyForm,
  VoidForm,
  WriteOffForm,
} from './invoice-forms';
import { getFormat, getLabels, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('invoice');

const dateTime = new Intl.DateTimeFormat('uk-UA', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Kyiv',
});

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getInvoice.run(ctx, { id });
  if (result.isErr()) notFound();
  const {
    invoice: inv,
    contractNumber,
    contract,
    clientName,
    periodMonth,
    periodId,
  } = result.value;
  const { lines, revisions, signed } = result.value;
  const isDraft = inv.status === 'draft';
  const revisable = inv.status === 'issued' && toDecimal(inv.paidAmount).isZero();
  const voidable = inv.status === 'issued' || inv.status === 'partially_paid';
  const preview = isDraft ? (await issuePreview.run(ctx, { id })).unwrapOr(null) : null;
  const render = isDraft ? null : (await invoiceRenderStatus.run(ctx, { id })).unwrapOr(null);
  const rendering =
    render?.revision === inv.revision &&
    (render.status === 'queued' || render.status === 'running');
  const latestSigned = signed[0];
  const payable = ['issued', 'partially_paid', 'paid'].includes(inv.status);
  const allocations = payable
    ? (await invoiceAllocations.run(ctx, { invoiceId: id })).unwrapOr([])
    : [];
  const candidates =
    payable && inv.status !== 'paid'
      ? (await paymentCandidates.run(ctx, { invoiceId: id })).unwrapOr([])
      : [];
  const outstanding = toDecimal(inv.total).minus(inv.paidAmount).toFixed(2);
  const signedOutdated = latestSigned && (latestSigned.sourceRevision ?? 0) < inv.revision;
  const [t, tc, fmt, { INVOICE_STATUS_LABELS }] = await Promise.all([
    getTranslations('invoice'),
    getTranslations('common'),
    getFormat(),
    getLabels(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">
          {t('back')}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {inv.number ? t('titleNumber', { number: inv.number }) : t('titleDraft')}
          <Badge variant={isDraft ? 'outline' : 'secondary'}>
            {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
          </Badge>
          {inv.revision > 1 && (
            <Badge variant="outline">{t('revision', { revision: inv.revision })}</Badge>
          )}
        </h1>
        <p className="text-muted-foreground">
          <Link href={`/clients/${inv.clientId}`} className="hover:underline">
            {clientName}
          </Link>{' '}
          · {t('contract')}{' '}
          <Link href={`/clients/contracts/${contract.id}`} className="hover:underline">
            {contractNumber}
          </Link>
          {periodMonth && periodId && (
            <>
              {' '}
              ·{' '}
              <Link href={`/periods/${periodId}`} className="hover:underline">
                {fmt.month(periodMonth)}
              </Link>
            </>
          )}
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">{t('date')}</div>
            {fmt.date(inv.issueDate)}
          </div>
          <div>
            <div className="text-muted-foreground">{t('due')}</div>
            {fmt.date(inv.dueDate)}
          </div>
          <div>
            <div className="text-muted-foreground">{t('total')}</div>
            {fmt.amount(inv.total, inv.currency)}
          </div>
          <div>
            <div className="text-muted-foreground">{t('paid')}</div>
            {fmt.amount(inv.paidAmount, inv.currency)}
          </div>
          {inv.status === 'written_off' && (
            <div className="sm:col-span-4" data-testid="write-off">
              <div className="text-muted-foreground">
                {t('writtenOff', { date: fmt.date(inv.writtenOffOn ?? '') })}
              </div>
              {t('badDebt', {
                amount: fmt.amount(
                  toDecimal(inv.total).minus(inv.paidAmount).toString(),
                  inv.currency,
                ),
              })}{' '}
              · {inv.writeOffReason}
            </div>
          )}
          {inv.voidReason && (
            <div className="sm:col-span-4">
              <div className="text-muted-foreground">{t('voidReason')}</div>
              {inv.voidReason}
            </div>
          )}
        </CardContent>
      </Card>

      {isDraft || revisable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isDraft ? t('lines') : t('change')}</CardTitle>
            {revisable && <CardDescription>{t('reviseDescription')}</CardDescription>}
          </CardHeader>
          <CardContent>
            <InvoiceEditForm
              invoiceId={inv.id}
              issueDate={inv.issueDate}
              dateOverrideReason={inv.dateOverrideReason}
              revising={revisable}
              lines={lines.map((l) => ({
                key: l.id,
                id: l.id,
                descriptionEn: l.descriptionEn,
                descriptionUa: l.descriptionUa,
                quantity: toDecimal(l.quantity).toString(),
                unitPrice: toDecimal(l.unitPrice).toString(),
              }))}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('lines')}</CardTitle>
            {!['void', 'written_off'].includes(inv.status) && (
              <CardDescription>{t('lockedDescription')}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col.description')}</TableHead>
                  <TableHead>{t('col.quantity')}</TableHead>
                  <TableHead>{t('col.price')}</TableHead>
                  <TableHead>{t('col.amount')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.descriptionEn}
                      <div className="text-muted-foreground">{l.descriptionUa}</div>
                    </TableCell>
                    <TableCell>{fmt.amount(l.quantity)}</TableCell>
                    <TableCell>{fmt.amount(l.unitPrice, inv.currency)}</TableCell>
                    <TableCell>{fmt.amount(l.amount, inv.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>{tc('total')}</TableCell>
                  <TableCell>{fmt.amount(inv.total, inv.currency)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

      {isDraft && preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('issue')}</CardTitle>
            <CardDescription>{t('issueDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <IssueForm invoiceId={inv.id} issueDate={inv.issueDate} preview={preview} />
          </CardContent>
        </Card>
      )}

      {!isDraft && inv.status !== 'void' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('fileTitle')}</CardTitle>
            <CardDescription>{t('fileDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {inv.pdfFileId ? (
              <p className="text-sm">{t('fileReady', { revision: inv.revision })}</p>
            ) : rendering ? (
              <p className="text-sm text-muted-foreground">
                {t('fileRendering')}
                {render.lastError ? t('previousAttempt', { error: render.lastError }) : ''}
              </p>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">
                  {render?.status === 'failed'
                    ? t('renderFailed', { error: render.lastError ?? t('unknownError') })
                    : t('noFile')}
                </p>
                <RegeneratePdfForm invoiceId={inv.id} />
              </div>
            )}
            {latestSigned ? (
              <p className="text-sm">
                {t('signed', {
                  date: latestSigned.signedAt ? dateTime.format(latestSigned.signedAt) : '',
                })}
                {latestSigned.sourceRevision
                  ? t('signedRevision', { revision: latestSigned.sourceRevision })
                  : ''}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noSigned')}</p>
            )}
            {signedOutdated && (
              <Alert role="status">
                <AlertDescription>{t('signedOutdated')}</AlertDescription>
              </Alert>
            )}
            <SignedCopyForm invoiceId={inv.id} />
          </CardContent>
        </Card>
      )}

      {payable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('payments')}</CardTitle>
            <CardDescription>
              {t('outstanding', { amount: fmt.amount(outstanding, inv.currency) })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {allocations.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {allocations.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 tabular-nums">{fmt.date(a.occurredOn)}</span>
                    <span className="font-medium">{fmt.amount(a.amount, a.currency)}</span>
                    {a.fxRate && (
                      <span className="text-muted-foreground">{t('rate', { rate: a.fxRate })}</span>
                    )}
                    <span className="text-muted-foreground">{a.counterparty}</span>
                    <RemoveAllocationButton id={a.id} invoiceId={inv.id} />
                  </li>
                ))}
              </ul>
            )}
            {inv.status !== 'paid' && (
              <AllocatePaymentForm
                invoiceId={inv.id}
                outstanding={outstanding}
                candidates={candidates.map((c) => ({
                  id: c.id,
                  remaining: c.remaining,
                  needsRate: c.needsRate,
                  label: `${t('candidate', {
                    date: fmt.date(c.occurredOn),
                    amount: fmt.amount(c.remaining, c.currency),
                    account: c.accountName,
                  })}${c.counterparty ? ` · ${c.counterparty}` : ''}`,
                }))}
              />
            )}
          </CardContent>
        </Card>
      )}

      {voidable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('void')}</CardTitle>
            <CardDescription>{t('voidDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <VoidForm invoiceId={inv.id} />
          </CardContent>
        </Card>
      )}

      {voidable && ctx.actor.role === 'owner' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('writeOff')}</CardTitle>
            <CardDescription>
              {t('writeOffDescription', {
                amount: fmt.amount(
                  toDecimal(inv.total).minus(inv.paidAmount).toString(),
                  inv.currency,
                ),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WriteOffForm invoiceId={inv.id} today={ctx.today} />
          </CardContent>
        </Card>
      )}

      {inv.status === 'void' && (
        <Card>
          <CardContent className="pt-6">
            <ReissueForm invoiceId={inv.id} />
          </CardContent>
        </Card>
      )}

      {revisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('revisions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('revCol.revision')}</TableHead>
                  <TableHead>{t('revCol.date')}</TableHead>
                  <TableHead>{t('revCol.total')}</TableHead>
                  <TableHead>{t('revCol.reason')}</TableHead>
                  <TableHead>{t('revCol.changed')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.revision}</TableCell>
                    <TableCell>{fmt.date(r.issueDate)}</TableCell>
                    <TableCell>{fmt.amount(r.total, inv.currency)}</TableCell>
                    <TableCell>{r.reason}</TableCell>
                    <TableCell>{dateTime.format(r.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <LinkedDocuments ctx={ctx} entityType="invoice" entityId={inv.id} canAdd />
      <AuditHistory ctx={ctx} tableName="invoice" rowId={inv.id} />
    </div>
  );
}
