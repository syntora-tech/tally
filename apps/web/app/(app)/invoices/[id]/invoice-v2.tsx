import { diffDays, toDecimal, type LocalDate } from '@tally/domain';
import type { Result } from 'neverthrow';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AuditHistory } from '@/components/audit-history';
import { AutoRefresh } from '@/components/auto-refresh';
import { LinkedDocuments } from '@/components/linked-documents';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DialogButton, RowMenu } from '@/components/v2/form-dialog';
import { PageHeader } from '@/components/v2/page-header';
import { CardLayout, Fact, Facts, FactsRule, Panel } from '@/components/v2/panel';
import { INVOICE_TONES, Status } from '@/components/v2/status';
import { Steps } from '@/components/v2/steps';
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

/** ✓ when the document exists, ○ while it is still to come. */
function Mark({ done }: { done: boolean }) {
  return done ? (
    <span className="font-bold text-success-foreground" aria-hidden>
      ✓
    </span>
  ) : (
    <span className="text-muted-foreground" aria-hidden>
      ○
    </span>
  );
}

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
    <table className="w-full min-w-[34rem] text-sm tabular-nums">
      <thead className="text-xs text-muted-foreground">
        <tr>
          <th className="px-5 py-2.5 text-left font-medium">{t('col.description')}</th>
          <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
            {t('col.quantity')}
          </th>
          <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">{t('col.price')}</th>
          <th className="px-5 py-2.5 text-right font-medium">{t('col.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="border-t">
            <td className="px-5 py-3">
              {l.descriptionEn}
              {l.descriptionUa !== l.descriptionEn && (
                <div className="text-xs text-muted-foreground">{l.descriptionUa}</div>
              )}
            </td>
            <td className="px-3 py-3 text-right">{fmt.amount(l.quantity)}</td>
            <td className="px-3 py-3 text-right">{fmt.amount(l.unitPrice, inv.currency)}</td>
            <td className="px-5 py-3 text-right">{fmt.amount(l.amount, inv.currency)}</td>
          </tr>
        ))}
        <tr className="border-t font-bold">
          <td colSpan={3} className="px-5 py-3">
            {tc('total')}
          </td>
          <td className="px-5 py-3 text-right" data-testid="invoice-total">
            {fmt.amount(inv.total, inv.currency)}
          </td>
        </tr>
      </tbody>
    </table>
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

  const flowStep = isDraft ? 1 : inv.status === 'paid' ? 3 : 2;
  const showFlow = !['void', 'written_off'].includes(inv.status);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={inv.number ? t('titleNumber', { number: inv.number }) : t('titleDraft')}
        crumb={inv.number ?? t('titleDraft')}
        badges={
          <>
            <Status tone={INVOICE_TONES[inv.status] ?? 'neutral'} testId="invoice-status">
              {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
            </Status>
            {inv.revision > 1 && <Status>{t('revision', { revision: inv.revision })}</Status>}
            {overdue > 0 && <Status tone="danger">{tv('overdue', { days: overdue })}</Status>}
          </>
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

      {showFlow && (
        <Steps
          label={tv('flowLabel')}
          current={flowStep}
          steps={[
            INVOICE_STATUS_LABELS.draft ?? 'draft',
            INVOICE_STATUS_LABELS.issued ?? 'issued',
            INVOICE_STATUS_LABELS.paid ?? 'paid',
          ]}
        />
      )}

      <CardLayout
        main={
          <>
            {isDraft && preview && (
              <Panel title={t('issue')} emphasis testId="issue-panel">
                <IssueForm invoiceId={inv.id} issueDate={inv.issueDate} preview={preview} />
              </Panel>
            )}
            {isDraft ? (
              <Panel title={t('lines')}>{editForm}</Panel>
            ) : (
              <Panel
                title={t('lines')}
                flush
                action={
                  !revisable && !['void', 'written_off'].includes(inv.status) ? (
                    <span className="text-xs text-muted-foreground">{tv('locked')}</span>
                  ) : undefined
                }
              >
                {linesTable}
              </Panel>
            )}
            {payable && (
              <Panel title={t('payments')}>
                {allocations.length === 0 ? (
                  <p className="text-muted-foreground">{tv('noPayments')}</p>
                ) : (
                  <ul className="-mx-5 flex flex-col divide-y border-t" data-testid="allocations">
                    {allocations.map((a) => (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
                      >
                        <span className="w-24 text-muted-foreground tabular-nums">
                          {fmt.date(a.occurredOn)}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {fmt.amount(a.amount, a.currency)}
                        </span>
                        {a.fxRate && (
                          <span className="text-muted-foreground">
                            {t('rate', { rate: a.fxRate })}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {a.counterparty}
                        </span>
                        <RemoveAllocationButton id={a.id} invoiceId={inv.id} />
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
            {revisions.length > 0 && (
              <Panel title={t('revisions')}>
                <ul className="-mx-5 flex flex-col divide-y border-t">
                  {revisions.map((r) => (
                    <li key={r.id} className="flex flex-wrap gap-x-3 px-5 py-2.5">
                      <span className="font-medium">{t('revision', { revision: r.revision })}</span>
                      <span className="text-muted-foreground">{fmt.date(r.issueDate)}</span>
                      <span className="tabular-nums">{fmt.amount(r.total, inv.currency)}</span>
                      <span className="flex-1">{r.reason}</span>
                      <span className="text-xs text-muted-foreground">
                        {dateTime.format(r.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            <AuditHistory ctx={ctx} tableName="invoice" rowId={inv.id} />
          </>
        }
        aside={
          <>
            <Panel>
              <Facts>
                <Fact label={tv('client')}>
                  <Link href={`/clients/${inv.clientId}`} className="text-link hover:underline">
                    {clientName}
                  </Link>
                </Fact>
                <Fact label={tv('contract')}>
                  <Link
                    href={`/clients/contracts/${contract.id}`}
                    className="text-link hover:underline"
                  >
                    {contractNumber}
                  </Link>
                </Fact>
                {periodMonth && periodId && (
                  <Fact label={tv('period')}>
                    <Link href={`/periods/${periodId}`} className="text-link hover:underline">
                      {fmt.month(periodMonth)}
                    </Link>
                  </Fact>
                )}
                <Fact label={t('date')}>{fmt.date(inv.issueDate)}</Fact>
                <Fact label={t('due')} tone={overdue > 0 ? 'danger' : undefined}>
                  {fmt.date(inv.dueDate)}
                </Fact>
                <FactsRule />
                <Fact label={t('total')}>{fmt.amount(inv.total, inv.currency)}</Fact>
                <Fact label={t('paid')}>{fmt.amount(inv.paidAmount, inv.currency)}</Fact>
                {payable && (
                  <Fact label={tv('left')} strong>
                    {amountLeft}
                  </Fact>
                )}
              </Facts>
              {inv.status === 'written_off' && (
                <p data-testid="write-off">
                  {t('writtenOff', { date: fmt.date(inv.writtenOffOn ?? '') })}:{' '}
                  {t('badDebt', { amount: amountLeft })} · {inv.writeOffReason}
                </p>
              )}
              {inv.voidReason && (
                <p>
                  <span className="text-muted-foreground">{t('voidReason')}:</span> {inv.voidReason}
                </p>
              )}
            </Panel>
            <LinkedDocuments
              ctx={ctx}
              entityType="invoice"
              entityId={inv.id}
              canAdd
              leading={
                !isDraft && inv.status !== 'void' ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2.5">
                      <Mark done={Boolean(inv.pdfFileId)} />
                      <span className="min-w-0 flex-1">
                        {tv('pdf', { revision: inv.revision })}
                        {inv.pdfFileId ? null : rendering ? (
                          <span className="block text-xs text-muted-foreground">
                            <AutoRefresh />
                            {t('fileRendering')}
                            {render.lastError
                              ? t('previousAttempt', { error: render.lastError })
                              : ''}
                          </span>
                        ) : (
                          render?.status === 'failed' && (
                            <span className="block text-xs text-danger-foreground">
                              {t('renderFailed', { error: render.lastError ?? t('unknownError') })}
                            </span>
                          )
                        )}
                      </span>
                      {!inv.pdfFileId && !rendering && <RegeneratePdfForm invoiceId={inv.id} />}
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Mark done={Boolean(latestSigned)} />
                      <span className="min-w-0 flex-1">
                        {tv('signedCopy')}
                        {latestSigned && (
                          <span className="block text-xs text-muted-foreground">
                            {t('signed', {
                              date: latestSigned.signedAt
                                ? dateTime.format(latestSigned.signedAt)
                                : '',
                            })}
                            {latestSigned.sourceRevision
                              ? t('signedRevision', { revision: latestSigned.sourceRevision })
                              : ''}
                          </span>
                        )}
                      </span>
                      <DialogButton
                        variant="outline"
                        title={tv('uploadSignedTitle')}
                        content={<SignedCopyForm invoiceId={inv.id} />}
                      >
                        {tv('uploadSigned')}
                      </DialogButton>
                    </div>
                    {signedOutdated && (
                      <Alert role="status">
                        <AlertDescription>{t('signedOutdated')}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : undefined
              }
            />
          </>
        }
      />
    </div>
  );
}
