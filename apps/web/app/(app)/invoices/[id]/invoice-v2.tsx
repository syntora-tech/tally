import { diffDays, toDecimal, type LocalDate } from '@tally/domain';
import type { Result } from 'neverthrow';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { AuditHistory } from '@/components/audit-history';
import { AutoRefresh } from '@/components/auto-refresh';
import { LinkedDocuments } from '@/components/linked-documents';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DialogButton, RowMenu } from '@/components/v2/form-dialog';
import { PageHeader } from '@/components/v2/page-header';
import { Status, type Tone } from '@/components/v2/status';
import { getFormat, getLabels } from '@/server/i18n';
import type { requireRole } from '@/server/request-context';
import type { invoiceAllocations, paymentCandidates } from '@/server/services/allocations';
import type { getInvoice, invoiceRenderStatus, issuePreview } from '@/server/services/invoices';
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

type OkOf<T> = T extends Result<infer V, unknown> ? V : never;
type Okd<F extends (...a: never[]) => unknown> = OkOf<Awaited<ReturnType<F>>>;

export const INVOICE_TONES: Record<string, Tone> = {
  draft: 'neutral',
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'neutral',
  written_off: 'danger',
};

const dateTime = new Intl.DateTimeFormat('uk-UA', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Kyiv',
});

export async function InvoiceV2({
  ctx,
  data,
  preview,
  render,
  allocations,
  candidates,
}: {
  ctx: Awaited<ReturnType<typeof requireRole>>;
  data: Okd<typeof getInvoice.run>;
  preview: Okd<typeof issuePreview.run> | null;
  render: Okd<typeof invoiceRenderStatus.run> | null;
  allocations: Okd<typeof invoiceAllocations.run>;
  candidates: Okd<typeof paymentCandidates.run>;
}) {
  const { invoice: inv, contractNumber, contract, clientName, periodMonth, periodId } = data;
  const { lines, revisions, signed } = data;
  const [t, tc, tv, fmt, { INVOICE_STATUS_LABELS }] = await Promise.all([
    getTranslations('invoice'),
    getTranslations('common'),
    getTranslations('invoice.v2'),
    getFormat(),
    getLabels(),
  ]);
  const isDraft = inv.status === 'draft';
  const revisable = inv.status === 'issued' && toDecimal(inv.paidAmount).isZero();
  const voidable = inv.status === 'issued' || inv.status === 'partially_paid';
  const payable = ['issued', 'partially_paid', 'paid'].includes(inv.status);
  const outstanding = toDecimal(inv.total).minus(inv.paidAmount).toFixed(2);
  const overdue =
    voidable && toDecimal(outstanding).gt(0) ? diffDays(inv.dueDate as LocalDate, ctx.today) : 0;
  const rendering =
    render?.revision === inv.revision &&
    (render.status === 'queued' || render.status === 'running');
  const latestSigned = signed[0];
  const signedOutdated = latestSigned && (latestSigned.sourceRevision ?? 0) < inv.revision;
  const amountLeft = fmt.amount(outstanding, inv.currency);

  const allocate = (
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
  );

  const linesTable = (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-2 pr-3 text-left font-medium">{t('col.description')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('col.quantity')}</th>
            <th className="px-3 py-2 text-right font-medium">{t('col.price')}</th>
            <th className="py-2 pl-3 text-right font-medium">{t('col.amount')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {lines.map((l) => (
            <tr key={l.id}>
              <td className="py-2 pr-3">
                {l.descriptionEn}
                <div className="text-xs text-muted-foreground">{l.descriptionUa}</div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt.amount(l.quantity)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmt.amount(l.unitPrice, inv.currency)}
              </td>
              <td className="py-2 pl-3 text-right tabular-nums">
                {fmt.amount(l.amount, inv.currency)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-semibold">
            <td colSpan={3} className="py-2 pr-3">
              {tc('total')}
            </td>
            <td className="py-2 pl-3 text-right tabular-nums" data-testid="invoice-total">
              {fmt.amount(inv.total, inv.currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );

  const editForm = (
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
  );

  const panel = (title: string, body: ReactNode, aside?: ReactNode, testId?: string) => (
    <section className="rounded-lg border bg-card" aria-label={title} data-testid={testId}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="font-heading font-semibold">{title}</h2>
        {aside}
      </div>
      <div className="px-4 py-3">{body}</div>
    </section>
  );

  const fact = (label: string, value: ReactNode, strong = false) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'text-right tabular-nums'}>{value}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={inv.number ? t('titleNumber', { number: inv.number }) : t('titleDraft')}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <Status tone={INVOICE_TONES[inv.status] ?? 'neutral'} testId="invoice-status">
              {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
            </Status>
            {inv.revision > 1 && <Status>{t('revision', { revision: inv.revision })}</Status>}
            {overdue > 0 && <Status tone="danger">{tv('overdue', { days: overdue })}</Status>}
          </span>
        }
      >
        <RowMenu
          label={tc('actions')}
          entries={[
            revisable && {
              label: tv('revise'),
              dialog: {
                title: t('change'),
                description: t('reviseDescription'),
                wide: true,
                content: editForm,
              },
            },
            'separator',
            voidable && {
              label: tv('voidAction'),
              destructive: true,
              dialog: {
                title: t('void'),
                description: t('voidDescription'),
                content: <VoidForm invoiceId={inv.id} />,
              },
            },
            voidable &&
              ctx.actor.role === 'owner' && {
                label: tv('writeOffAction'),
                destructive: true,
                dialog: {
                  title: t('writeOff'),
                  description: t('writeOffDescription', { amount: amountLeft }),
                  content: <WriteOffForm invoiceId={inv.id} today={ctx.today} />,
                },
              },
          ]}
        />
        {payable && inv.status !== 'paid' && (
          <DialogButton
            size="default"
            title={tv('allocateTitle')}
            description={t('outstanding', { amount: amountLeft })}
            content={allocate}
            testId="allocate"
          >
            {tv('allocate')}
          </DialogButton>
        )}
        {inv.status === 'void' && <ReissueForm invoiceId={inv.id} />}
      </PageHeader>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {isDraft &&
            preview &&
            panel(
              t('issue'),
              <IssueForm invoiceId={inv.id} issueDate={inv.issueDate} preview={preview} />,
              undefined,
              'issue-panel',
            )}
          {panel(
            t('lines'),
            isDraft ? editForm : linesTable,
            !isDraft && !revisable && !['void', 'written_off'].includes(inv.status) ? (
              <span className="text-xs text-muted-foreground">{tv('locked')}</span>
            ) : undefined,
          )}
          {payable &&
            panel(
              t('payments'),
              allocations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tv('noPayments')}</p>
              ) : (
                <ul className="flex flex-col divide-y text-sm" data-testid="allocations">
                  {allocations.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <span className="w-24 tabular-nums text-muted-foreground">
                        {fmt.date(a.occurredOn)}
                      </span>
                      <span className="font-medium tabular-nums">
                        {fmt.amount(a.amount, a.currency)}
                      </span>
                      {a.fxRate && (
                        <span className="text-muted-foreground">
                          {t('rate', { rate: a.fxRate })}
                        </span>
                      )}
                      <span className="flex-1 truncate text-muted-foreground">
                        {a.counterparty}
                      </span>
                      <RemoveAllocationButton id={a.id} invoiceId={inv.id} />
                    </li>
                  ))}
                </ul>
              ),
            )}
          {revisions.length > 0 &&
            panel(
              t('revisions'),
              <ul className="flex flex-col divide-y text-sm">
                {revisions.map((r) => (
                  <li key={r.id} className="flex flex-wrap gap-x-3 py-2">
                    <span className="font-medium">{t('revision', { revision: r.revision })}</span>
                    <span className="text-muted-foreground">{fmt.date(r.issueDate)}</span>
                    <span className="tabular-nums">{fmt.amount(r.total, inv.currency)}</span>
                    <span className="flex-1">{r.reason}</span>
                    <span className="text-xs text-muted-foreground">
                      {dateTime.format(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>,
            )}
        </div>

        <aside className="flex flex-col gap-5">
          {panel(
            tv('details'),
            <dl className="text-sm">
              {fact(
                tv('client'),
                <Link href={`/clients/${inv.clientId}`} className="text-link hover:underline">
                  {clientName}
                </Link>,
              )}
              {fact(
                t('contract'),
                <Link
                  href={`/clients/contracts/${contract.id}`}
                  className="text-link hover:underline"
                >
                  {contractNumber}
                </Link>,
              )}
              {periodMonth &&
                periodId &&
                fact(
                  tv('period'),
                  <Link href={`/periods/${periodId}`} className="text-link hover:underline">
                    {fmt.month(periodMonth)}
                  </Link>,
                )}
              {fact(t('date'), fmt.date(inv.issueDate))}
              {fact(t('due'), fmt.date(inv.dueDate))}
              <div className="my-2 border-t" />
              {fact(t('total'), fmt.amount(inv.total, inv.currency), true)}
              {fact(t('paid'), fmt.amount(inv.paidAmount, inv.currency))}
              {payable && fact(tv('left'), amountLeft, true)}
              {inv.status === 'written_off' && (
                <p className="mt-2 text-sm" data-testid="write-off">
                  {t('writtenOff', { date: fmt.date(inv.writtenOffOn ?? '') })}:{' '}
                  {t('badDebt', { amount: amountLeft })} · {inv.writeOffReason}
                </p>
              )}
              {inv.voidReason && (
                <p className="mt-2 text-sm">
                  <span className="text-muted-foreground">{t('voidReason')}:</span> {inv.voidReason}
                </p>
              )}
            </dl>,
          )}
          {!isDraft &&
            inv.status !== 'void' &&
            panel(
              t('fileTitle'),
              <div className="flex flex-col gap-3 text-sm">
                {inv.pdfFileId ? (
                  <p>{tv('pdfReady', { revision: inv.revision })}</p>
                ) : rendering ? (
                  <p className="text-muted-foreground">
                    <AutoRefresh />
                    {t('fileRendering')}
                    {render.lastError ? t('previousAttempt', { error: render.lastError }) : ''}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground">
                      {render?.status === 'failed'
                        ? t('renderFailed', { error: render.lastError ?? t('unknownError') })
                        : t('noFile')}
                    </p>
                    <RegeneratePdfForm invoiceId={inv.id} />
                  </div>
                )}
                {latestSigned ? (
                  <p>
                    {t('signed', {
                      date: latestSigned.signedAt ? dateTime.format(latestSigned.signedAt) : '',
                    })}
                    {latestSigned.sourceRevision
                      ? t('signedRevision', { revision: latestSigned.sourceRevision })
                      : ''}
                  </p>
                ) : (
                  <p className="text-muted-foreground">{t('noSigned')}</p>
                )}
                {signedOutdated && (
                  <Alert role="status">
                    <AlertDescription>{t('signedOutdated')}</AlertDescription>
                  </Alert>
                )}
                <SignedCopyForm invoiceId={inv.id} />
              </div>,
            )}
        </aside>
      </div>

      <LinkedDocuments ctx={ctx} entityType="invoice" entityId={inv.id} canAdd />
      <AuditHistory ctx={ctx} tableName="invoice" rowId={inv.id} />
    </div>
  );
}
