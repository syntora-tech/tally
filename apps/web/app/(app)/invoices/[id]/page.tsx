import { formatAmount, formatUaDate, toDecimal, type LocalDate } from '@tally/domain';
import type { Metadata } from 'next';
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
import { INVOICE_STATUS_LABELS } from '@/lib/labels';
import { monthTitle } from '@/lib/months';
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
} from './invoice-forms';

export const metadata: Metadata = { title: 'Інвойс · Tally' };

const FIELD_LABELS: Record<string, string> = {
  number: 'Номер',
  status: 'Статус',
  issue_date: 'Дата',
  due_date: 'Оплатити до',
  total: 'Сума',
  paid_amount: 'Оплачено',
  revision: 'Редакція',
  void_reason: 'Причина анулювання',
  date_override_reason: 'Причина дати',
};

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/invoices" className="text-sm text-muted-foreground hover:underline">
          ← Інвойси
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {inv.number ? `Інвойс № ${inv.number}` : 'Чернетка інвойсу'}
          <Badge variant={isDraft ? 'outline' : 'secondary'}>
            {INVOICE_STATUS_LABELS[inv.status] ?? inv.status}
          </Badge>
          {inv.revision > 1 && <Badge variant="outline">редакція {inv.revision}</Badge>}
        </h1>
        <p className="text-muted-foreground">
          <Link href={`/clients/${inv.clientId}`} className="hover:underline">
            {clientName}
          </Link>{' '}
          · договір{' '}
          <Link href={`/clients/contracts/${contract.id}`} className="hover:underline">
            {contractNumber}
          </Link>
          {periodMonth && periodId && (
            <>
              {' '}
              ·{' '}
              <Link href={`/periods/${periodId}`} className="hover:underline">
                {monthTitle(periodMonth)}
              </Link>
            </>
          )}
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 text-sm sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">Дата</div>
            {formatUaDate(inv.issueDate as LocalDate)}
          </div>
          <div>
            <div className="text-muted-foreground">Оплатити до</div>
            {formatUaDate(inv.dueDate as LocalDate)}
          </div>
          <div>
            <div className="text-muted-foreground">Сума</div>
            {formatAmount(inv.total, inv.currency)}
          </div>
          <div>
            <div className="text-muted-foreground">Оплачено</div>
            {formatAmount(inv.paidAmount, inv.currency)}
          </div>
          {inv.voidReason && (
            <div className="sm:col-span-4">
              <div className="text-muted-foreground">Причина анулювання</div>
              {inv.voidReason}
            </div>
          )}
        </CardContent>
      </Card>

      {isDraft || revisable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isDraft ? 'Рядки' : 'Змінити інвойс'}</CardTitle>
            {revisable && (
              <CardDescription>
                Інвойс ще не оплачено, тож його можна змінити зі збереженням номера. Буде створено
                нову редакцію, попередня лишиться в історії; підписану копію треба буде завантажити
                знову.
              </CardDescription>
            )}
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
            <CardTitle className="text-base">Рядки</CardTitle>
            {inv.status !== 'void' && (
              <CardDescription>
                Інвойс має оплати, тож змінити його не можна — лише анулювати й перевипустити.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Опис</TableHead>
                  <TableHead>К-сть</TableHead>
                  <TableHead>Ціна</TableHead>
                  <TableHead>Сума</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      {l.descriptionEn}
                      <div className="text-muted-foreground">{l.descriptionUa}</div>
                    </TableCell>
                    <TableCell>{formatAmount(l.quantity)}</TableCell>
                    <TableCell>{formatAmount(l.unitPrice, inv.currency)}</TableCell>
                    <TableCell>{formatAmount(l.amount, inv.currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3}>Разом</TableCell>
                  <TableCell>{formatAmount(inv.total, inv.currency)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
      )}

      {isDraft && preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Випуск</CardTitle>
            <CardDescription>
              Номер присвоюється лише при випуску й більше не змінюється
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IssueForm invoiceId={inv.id} issueDate={inv.issueDate} preview={preview} />
          </CardContent>
        </Card>
      )}

      {!isDraft && inv.status !== 'void' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Файл і підписання</CardTitle>
            <CardDescription>
              Після підпису завантажте підписаний файл — він замінить згенерований у документах
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {inv.pdfFileId ? (
              <p className="text-sm">
                Файл редакції {inv.revision} згенеровано — він у документах нижче
              </p>
            ) : rendering ? (
              <p className="text-sm text-muted-foreground">
                Файл генерується… Оновіть сторінку за хвилину
                {render.lastError ? ` (попередня спроба: ${render.lastError})` : ''}
              </p>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">
                  {render?.status === 'failed'
                    ? `Не вдалося згенерувати файл: ${render.lastError ?? 'невідома помилка'}`
                    : 'Файлу для цієї редакції ще немає'}
                </p>
                <RegeneratePdfForm invoiceId={inv.id} />
              </div>
            )}
            {latestSigned ? (
              <p className="text-sm">
                Підписано {latestSigned.signedAt ? dateTime.format(latestSigned.signedAt) : ''}
                {latestSigned.sourceRevision
                  ? ` (редакція ${String(latestSigned.sourceRevision)})`
                  : ''}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Підписаної копії ще немає</p>
            )}
            {signedOutdated && (
              <Alert role="status">
                <AlertDescription>
                  Підписана копія стосується попередньої редакції — інвойс відтоді змінено.
                </AlertDescription>
              </Alert>
            )}
            <SignedCopyForm invoiceId={inv.id} />
          </CardContent>
        </Card>
      )}

      {payable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Оплати</CardTitle>
            <CardDescription>
              Залишок до сплати: {formatAmount(outstanding, inv.currency)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {allocations.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {allocations.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 tabular-nums">
                      {formatUaDate(a.occurredOn as LocalDate)}
                    </span>
                    <span className="font-medium">{formatAmount(a.amount, a.currency)}</span>
                    {a.fxRate && <span className="text-muted-foreground">курс {a.fxRate}</span>}
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
                  label: `${formatUaDate(c.occurredOn as LocalDate)} · ${formatAmount(c.remaining, c.currency)} вільно · ${c.accountName}${c.counterparty ? ` · ${c.counterparty}` : ''}`,
                }))}
              />
            )}
          </CardContent>
        </Card>
      )}

      {voidable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Анулювання</CardTitle>
            <CardDescription>
              Номер лишається зайнятим; години можна перенести в новий інвойс через «Перевипустити»
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VoidForm invoiceId={inv.id} />
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
            <CardTitle className="text-base">Попередні редакції</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Редакція</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Сума</TableHead>
                  <TableHead>Причина зміни</TableHead>
                  <TableHead>Змінено</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.revision}</TableCell>
                    <TableCell>{formatUaDate(r.issueDate as LocalDate)}</TableCell>
                    <TableCell>{formatAmount(r.total, inv.currency)}</TableCell>
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
      <AuditHistory ctx={ctx} tableName="invoice" rowId={inv.id} fieldLabels={FIELD_LABELS} />
    </div>
  );
}
