'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deleteContractorInvoiceAction,
  draftContractorInvoiceAction,
  issueContractorInvoiceAction,
  rerenderContractorInvoiceAction,
  saveContractorInvoiceDraftAction,
  signContractorInvoiceAction,
  voidContractorInvoiceAction,
  type ContractorInvoiceFormState,
} from '@/server/actions/contractor-invoices';
import { useCloseOnSuccess } from '@/components/v2/form-dialog';

type Action = (
  prev: ContractorInvoiceFormState,
  formData: FormData,
) => Promise<ContractorInvoiceFormState>;

function useForm(action: Action, success?: string) {
  const [state, run, pending] = useActionState<ContractorInvoiceFormState, FormData>(action, null);
  useCloseOnSuccess(state);
  useEffect(() => {
    if (state?.ok && success) toast.success(success);
  }, [state, success]);
  return { run, pending, error: state && !state.ok ? state.error : null };
}

function ErrorAlert({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert" className="w-full">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export function DraftContractorInvoiceButton({ payrollItemId }: { payrollItemId: string }) {
  const t = useTranslations('contractorInvoice');
  const { run, pending, error } = useForm(draftContractorInvoiceAction);
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="payrollItemId" value={payrollItemId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t('draft')}
      </Button>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

export function ContractorInvoiceDraftForm(props: {
  id: string;
  invoiceDate: string;
  descriptionEn: string;
  descriptionUa: string;
}) {
  const t = useTranslations('contractorInvoice');
  const tc = useTranslations('common');
  const { run, pending, error } = useForm(saveContractorInvoiceDraftAction, t('saved'));
  return (
    <form action={run} className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-3">
      <input type="hidden" name="id" value={props.id} />
      <FormField label={t('date')} htmlFor="ci-date" error={error?.fieldErrors?.invoiceDate}>
        <Input id="ci-date" name="invoiceDate" type="date" defaultValue={props.invoiceDate} />
      </FormField>
      <FormField
        label={t('descriptionEn')}
        htmlFor="ci-en"
        error={error?.fieldErrors?.descriptionEn}
      >
        <Input id="ci-en" name="descriptionEn" defaultValue={props.descriptionEn} />
      </FormField>
      <FormField
        label={t('descriptionUa')}
        htmlFor="ci-ua"
        error={error?.fieldErrors?.descriptionUa}
      >
        <Input id="ci-ua" name="descriptionUa" defaultValue={props.descriptionUa} />
      </FormField>
      <div className="md:col-span-3">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
        <Button type="submit" variant="outline" disabled={pending}>
          {tc('save')}
        </Button>
      </div>
    </form>
  );
}

export function IssueContractorInvoiceForm({ id, number }: { id: string; number: string }) {
  const t = useTranslations('contractorInvoice');
  const { run, pending, error } = useForm(issueContractorInvoiceAction, t('issued'));
  return (
    <form action={run} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label={t('number')} htmlFor="ci-number" error={error?.fieldErrors?.number}>
        <Input id="ci-number" name="number" placeholder={number} className="w-48" />
      </FormField>
      <Button type="submit" disabled={pending}>
        {t('issue')}
      </Button>
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
    </form>
  );
}

/** Both sides signed (A-096): a link (DocuSign) and/or the signed PDF; the payout may be paid. */
export function SignContractorInvoiceForm({ id }: { id: string }) {
  const t = useTranslations('contractorInvoice');
  const { run, pending, error } = useForm(signContractorInvoiceAction, t('signedSaved'));
  return (
    <form
      action={run}
      className="flex flex-wrap items-end gap-2"
      data-testid="sign-contractor-invoice"
    >
      <input type="hidden" name="id" value={id} />
      <FormField
        label={t('signedUrl')}
        htmlFor="ci-signed-url"
        error={error?.fieldErrors?.signedUrl}
      >
        <Input id="ci-signed-url" name="signedUrl" type="url" className="w-80" />
      </FormField>
      <FormField label={t('signedFile')} htmlFor="ci-signed-file" error={error?.fieldErrors?.file}>
        <Input id="ci-signed-file" name="file" type="file" accept="application/pdf,image/*" />
      </FormField>
      <Button type="submit" disabled={pending}>
        {t('markSigned')}
      </Button>
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
    </form>
  );
}

/** Renders the issued invoice again with the current template (A-093). */
export function RerenderContractorInvoiceForm({ id }: { id: string }) {
  const t = useTranslations('contractorInvoice');
  const { run, pending, error } = useForm(rerenderContractorInvoiceAction, t('rerendered'));
  return (
    <form
      action={run}
      className="flex flex-wrap items-end gap-2"
      data-testid="rerender-contractor-invoice"
    >
      <input type="hidden" name="id" value={id} />
      <FormField
        label={t('rerenderReason')}
        htmlFor="ci-rerender"
        error={error?.fieldErrors?.reason}
      >
        <Input id="ci-rerender" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {t('rerender')}
      </Button>
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
    </form>
  );
}

export function VoidContractorInvoiceForm({ id }: { id: string }) {
  const t = useTranslations('contractorInvoice');
  const { run, pending, error } = useForm(voidContractorInvoiceAction, t('voided'));
  return (
    <form action={run} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label={t('voidReason')} htmlFor="ci-void" error={error?.fieldErrors?.reason}>
        <Input id="ci-void" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" variant="destructive" disabled={pending}>
        {t('void')}
      </Button>
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
    </form>
  );
}

export function DeleteContractorInvoiceForm({ id }: { id: string }) {
  const t = useTranslations('contractorInvoice');
  const { run, pending, error } = useForm(deleteContractorInvoiceAction);
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {t('deleteDraft')}
      </Button>
      <ErrorAlert message={error?.message} />
    </form>
  );
}
