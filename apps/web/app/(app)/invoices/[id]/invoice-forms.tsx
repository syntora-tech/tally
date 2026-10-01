'use client';

import { formatUaDate, type LocalDate } from '@tally/domain';
import { Plus, Trash2 } from 'lucide-react';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  allocatePaymentAction,
  attachSignedInvoiceAction,
  issueInvoiceAction,
  issuePreviewAction,
  regenerateInvoicePdfAction,
  removeAllocationAction,
  reissueInvoiceAction,
  saveInvoiceAction,
  voidInvoiceAction,
  type InvoiceFormState,
} from '@/server/actions/invoices';

function useResult(state: InvoiceFormState, success: string) {
  useEffect(() => {
    if (state?.ok) toast.success(success);
  }, [state, success]);
  return state && !state.ok ? state.error : null;
}

function ErrorAlert({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export type EditableLine = {
  key: string;
  id: string;
  descriptionEn: string;
  descriptionUa: string;
  quantity: string;
  unitPrice: string;
};

/**
 * Draft editing, or a revision of an issued unpaid invoice (A-044): same number, reason required.
 */
export function InvoiceEditForm(props: {
  invoiceId: string;
  issueDate: string;
  dateOverrideReason: string | null;
  lines: EditableLine[];
  revising: boolean;
}) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    saveInvoiceAction,
    null,
  );
  const error = useResult(state, props.revising ? 'Нову редакцію збережено' : 'Чернетку збережено');
  const [lines, setLines] = useState(props.lines);
  const [nextKey, setNextKey] = useState(0);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={props.invoiceId} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Дата інвойсу" htmlFor="issueDate" error={error?.fieldErrors?.issueDate}>
          <Input
            id="issueDate"
            name="issueDate"
            type="date"
            defaultValue={props.issueDate}
            className="w-44"
          />
        </FormField>
        <FormField label="Причина дати поза правилом (власник)" htmlFor="dateOverrideReason">
          <Input
            id="dateOverrideReason"
            name="dateOverrideReason"
            defaultValue={props.dateOverrideReason ?? ''}
            className="w-72"
          />
        </FormField>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Опис (EN)</TableHead>
              <TableHead>Опис (UA)</TableHead>
              <TableHead className="w-28">К-сть</TableHead>
              <TableHead className="w-32">Ціна</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={l.key}>
                <TableCell>
                  <input type="hidden" name={`lines.${String(i)}.id`} value={l.id} />
                  <Input
                    name={`lines.${String(i)}.descriptionEn`}
                    defaultValue={l.descriptionEn}
                    aria-label="Опис англійською"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    name={`lines.${String(i)}.descriptionUa`}
                    defaultValue={l.descriptionUa}
                    aria-label="Опис українською"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    name={`lines.${String(i)}.quantity`}
                    defaultValue={l.quantity}
                    inputMode="decimal"
                    aria-label="Кількість"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    name={`lines.${String(i)}.unitPrice`}
                    defaultValue={l.unitPrice}
                    inputMode="decimal"
                    aria-label="Ціна"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Видалити рядок"
                    onClick={() => {
                      setLines(lines.filter((x) => x.key !== l.key));
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setLines([
              ...lines,
              {
                key: `new-${String(nextKey)}`,
                id: '',
                descriptionEn: '',
                descriptionUa: '',
                quantity: '1',
                unitPrice: '',
              },
            ]);
            setNextKey(nextKey + 1);
          }}
        >
          <Plus className="size-4" /> Рядок
        </Button>
      </div>
      {props.revising && (
        <FormField label="Причина зміни" htmlFor="reason" error={error?.fieldErrors?.reason}>
          <Input id="reason" name="reason" required className="max-w-xl" />
        </FormField>
      )}
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      {error?.fieldErrors?.lines && <ErrorAlert message={error.fieldErrors.lines[0]} />}
      <div>
        <Button type="submit" disabled={pending}>
          {props.revising ? 'Зберегти нову редакцію' : 'Зберегти чернетку'}
        </Button>
      </div>
    </form>
  );
}

type Preview = {
  suggestedDate: string;
  dueDate: string;
  isWorkingDay: boolean;
  earlierThanPrevious: boolean;
  previous: { issueDate: string; number: string | null } | null;
};

/** Issue dialog (6.5): date by rule, recomputed due date, working-day and ordering warnings. */
export function IssueForm(props: { invoiceId: string; issueDate: string; preview: Preview }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    issueInvoiceAction,
    null,
  );
  const error = useResult(state, 'Інвойс випущено');
  const [preview, setPreview] = useState(props.preview);
  const [checking, startCheck] = useTransition();

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={props.invoiceId} />
      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Дата випуску" htmlFor="issue-date" error={error?.fieldErrors?.issueDate}>
          <Input
            id="issue-date"
            name="issueDate"
            type="date"
            defaultValue={props.issueDate}
            className="w-44"
            onChange={(e) => {
              const value = e.target.value;
              startCheck(async () => {
                const res = await issuePreviewAction(props.invoiceId, value);
                if (res.ok) setPreview(res.data);
              });
            }}
          />
        </FormField>
        <FormField label="Причина неробочої дати (власник)" htmlFor="issue-override">
          <Input id="issue-override" name="dateOverrideReason" className="w-72" />
        </FormField>
      </div>
      <p className="text-sm text-muted-foreground">
        За правилом договору: {formatUaDate(preview.suggestedDate as LocalDate)}. Оплатити до:{' '}
        {formatUaDate(preview.dueDate as LocalDate)}.{checking && ' Перевіряю…'}
      </p>
      {!preview.isWorkingDay && (
        <ErrorAlert message="Обрана дата — неробочий день. Випуск можливий лише власником із причиною." />
      )}
      {preview.earlierThanPrevious && preview.previous && (
        <Alert role="status">
          <AlertDescription>
            Дата раніша за попередній випущений документ цієї нумерації ({preview.previous.number},{' '}
            {formatUaDate(preview.previous.issueDate as LocalDate)}).
          </AlertDescription>
        </Alert>
      )}
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      <div>
        <Button type="submit" disabled={pending}>
          Випустити й присвоїти номер
        </Button>
      </div>
    </form>
  );
}

export function VoidForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    voidInvoiceAction,
    null,
  );
  const error = useResult(state, 'Інвойс анульовано');
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={invoiceId} />
      <FormField
        label="Причина анулювання"
        htmlFor="void-reason"
        error={error?.fieldErrors?.reason}
      >
        <Input id="void-reason" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" variant="destructive" disabled={pending}>
        Анулювати
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function ReissueForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    reissueInvoiceAction,
    null,
  );
  const error = useResult(state, 'Створено нову чернетку');
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={invoiceId} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          Перевипустити (нова чернетка)
        </Button>
      </div>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

/** Signed copy from the signing service (A-039); it becomes the current file of the invoice. */
export function SignedCopyForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    attachSignedInvoiceAction,
    null,
  );
  const error = useResult(state, 'Підписану копію збережено');
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <FormField label="Підписаний файл" htmlFor="signed-file" error={error?.fieldErrors?.file}>
        <Input id="signed-file" name="file" type="file" accept="application/pdf,image/*" />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        Завантажити підписану
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function RegeneratePdfForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    regenerateInvoicePdfAction,
    null,
  );
  const error = useResult(state, 'PDF поставлено в чергу');
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={invoiceId} />
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Перегенерувати PDF
        </Button>
      </div>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

export type PaymentCandidate = {
  id: string;
  label: string;
  remaining: string;
  needsRate: boolean;
};

/** Links a revenue transaction to this invoice (6.5); the DB keeps the totals (I7). */
export function AllocatePaymentForm(props: {
  invoiceId: string;
  outstanding: string;
  candidates: PaymentCandidate[];
}) {
  // A full payment removes this form, so the toast fires before the page re-renders.
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    async (prev, formData) => {
      const result = await allocatePaymentAction(prev, formData);
      if (result?.ok) toast.success('Оплату зараховано');
      return result;
    },
    null,
  );
  const error = state && !state.ok ? state.error : null;
  const [selected, setSelected] = useState('');
  const candidate = props.candidates.find((c) => c.id === selected);
  if (props.candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Немає нерозподілених надходжень — спершу додайте дохід у Ledger
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="invoiceId" value={props.invoiceId} />
      <FormField label="Надходження" htmlFor="pay-tx" error={error?.fieldErrors?.transactionId}>
        <select
          id="pay-tx"
          name="transactionId"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
          }}
          className="h-9 max-w-md rounded-md border border-input bg-transparent px-2.5 text-sm"
        >
          <option value="">Оберіть транзакцію</option>
          {props.candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField
        label="Сума в валюті інвойсу"
        htmlFor="pay-amount"
        error={error?.fieldErrors?.amount}
      >
        <Input
          id="pay-amount"
          name="amount"
          key={selected}
          inputMode="decimal"
          defaultValue={props.outstanding}
          className="w-36"
        />
      </FormField>
      {candidate?.needsRate && (
        <FormField label="Курс (одиниць надходження за 1)" htmlFor="pay-rate">
          <Input id="pay-rate" name="fxRate" inputMode="decimal" required className="w-36" />
        </FormField>
      )}
      <Button type="submit" disabled={pending || !selected}>
        Зарахувати оплату
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function RemoveAllocationButton({ id, invoiceId }: { id: string; invoiceId: string }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(
    removeAllocationAction,
    null,
  );
  useResult(state, 'Розподіл знято');
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Зняти
      </Button>
    </form>
  );
}
