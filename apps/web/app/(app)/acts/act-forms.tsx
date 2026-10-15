'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  attachSignedActAction,
  createActAction,
  issueActWithDocumentAction,
  deleteDraftActAction,
  issueActAction,
  saveActDraftAction,
  setSignedUrlAction,
  voidActAction,
  type ActFormState,
} from '@/server/actions/acts';

function useResult(state: ActFormState, success: string) {
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

export function ActDraftForm(props: {
  id: string;
  actDate: string;
  amountUah: string;
  editableAmount: boolean;
  dateOverrideReason: string | null;
}) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(saveActDraftAction, null);
  const t = useTranslations('actForms');
  const tc = useTranslations('common');
  const error = useResult(state, t('draftSaved'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={props.id} />
      <FormField label={t('actDate')} htmlFor="act-date" error={error?.fieldErrors?.actDate}>
        <Input id="act-date" name="actDate" type="date" defaultValue={props.actDate} />
      </FormField>
      {props.editableAmount && (
        <FormField
          label={t('amountUah')}
          htmlFor="act-amount"
          error={error?.fieldErrors?.amountUah}
        >
          <Input
            id="act-amount"
            name="amountUah"
            inputMode="decimal"
            defaultValue={props.amountUah}
          />
        </FormField>
      )}
      <FormField label={t('nonWorkingReason')} htmlFor="act-override">
        <Input
          id="act-override"
          name="dateOverrideReason"
          defaultValue={props.dateOverrideReason ?? ''}
          className="w-72"
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {tc('save')}
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function IssueActForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(issueActAction, null);
  const t = useTranslations('actForms');
  const error = useResult(state, t('issued'));
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('issue')}
        </Button>
      </div>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

export function VoidActForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(voidActAction, null);
  const t = useTranslations('actForms');
  const error = useResult(state, t('voided'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label={t('voidReason')} htmlFor="act-void" error={error?.fieldErrors?.reason}>
        <Input id="act-void" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" variant="destructive" disabled={pending}>
        {t('void')}
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function DeleteDraftActForm({ id, partOfMonth }: { id: string; partOfMonth: boolean }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(
    deleteDraftActAction,
    null,
  );
  const t = useTranslations('actForms');
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <p className="w-full text-sm text-muted-foreground">
        {partOfMonth ? t('deleteMergeHint') : t('deleteHint')}
      </p>
      <FormField label={t('deleteReason')} htmlFor="act-delete" error={error?.fieldErrors?.reason}>
        <Input id="act-delete" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" variant="destructive" disabled={pending}>
        {t('deleteDraft')}
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function SignedUrlForm({ id, value }: { id: string; value: string | null }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(setSignedUrlAction, null);
  const t = useTranslations('actForms');
  const tc = useTranslations('common');
  const error = useResult(state, t('linkSaved'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label={t('signedLink')} htmlFor="act-signed" error={error?.fieldErrors?.signedUrl}>
        <Input
          id="act-signed"
          name="signedUrl"
          defaultValue={value ?? ''}
          placeholder="https://vchasno.ua/…"
          className="w-96"
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {tc('save')}
      </Button>
    </form>
  );
}

/** A draft act issued with a document made outside Tally (A-101). */
export function OwnDocumentActForm({ id, actDate }: { id: string; actDate: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(
    issueActWithDocumentAction,
    null,
  );
  const t = useTranslations('actForms');
  const error = useResult(state, t('ownIssued'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id} />
      <p className="w-full text-sm text-muted-foreground">{t('ownHint')}</p>
      <FormField label={t('ownNumber')} htmlFor="act-own-number" error={error?.fieldErrors?.number}>
        <Input id="act-own-number" name="number" required className="w-40" />
      </FormField>
      <FormField label={t('ownDate')} htmlFor="act-own-date" error={error?.fieldErrors?.actDate}>
        <Input id="act-own-date" name="actDate" type="date" defaultValue={actDate} />
      </FormField>
      <FormField label={t('nonWorkingReason')} htmlFor="act-own-override">
        <Input id="act-own-override" name="dateOverrideReason" className="w-72" />
      </FormField>
      <FormField label={t('ownFile')} htmlFor="act-own-file" error={error?.fieldErrors?.file}>
        <Input id="act-own-file" name="file" type="file" accept="application/pdf" required />
      </FormField>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="signed" />
        {t('ownSigned')}
      </label>
      <FormField
        label={t('signedLink')}
        htmlFor="act-own-link"
        error={error?.fieldErrors?.signedUrl}
      >
        <Input
          id="act-own-link"
          name="signedUrl"
          placeholder="https://vchasno.ua/…"
          className="w-80"
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {t('ownIssue')}
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

/** The signed copy of an issued act as a PDF, instead of a Vchasno link (A-101). */
export function SignedFileForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(
    attachSignedActAction,
    null,
  );
  const t = useTranslations('actForms');
  const error = useResult(state, t('signedFileSaved'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label={t('signedFile')} htmlFor="act-signed-file" error={error?.fieldErrors?.file}>
        <Input id="act-signed-file" name="file" type="file" accept="application/pdf" required />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        {t('signedFileSave')}
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function NewActForm(props: { contracts: { id: string; label: string }[]; today: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(createActAction, null);
  const t = useTranslations('actForms');
  const error = useResult(state, t('created'));
  return (
    <form action={action} className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-3">
      <FormField
        label={t('contract')}
        htmlFor="new-contract"
        error={error?.fieldErrors?.contractId}
        className="md:col-span-2"
      >
        <NativeSelect
          id="new-contract"
          name="contractId"
          placeholder={t('chooseContract')}
          options={props.contracts.map((c) => ({ value: c.id, label: c.label }))}
        />
      </FormField>
      <FormField label={t('type')} htmlFor="new-type">
        <NativeSelect
          id="new-type"
          name="type"
          defaultValue="reimbursement"
          options={[
            { value: 'reimbursement', label: t('reimbursement') },
            { value: 'other', label: t('other') },
          ]}
        />
      </FormField>
      <FormField label={t('actDate')} htmlFor="new-date" error={error?.fieldErrors?.actDate}>
        <Input id="new-date" name="actDate" type="date" defaultValue={props.today} />
      </FormField>
      <FormField label={t('periodFrom')} htmlFor="new-from">
        <Input id="new-from" name="periodFrom" type="date" />
      </FormField>
      <FormField label={t('periodTo')} htmlFor="new-to">
        <Input id="new-to" name="periodTo" type="date" />
      </FormField>
      <FormField label={t('amountUah')} htmlFor="new-amount" error={error?.fieldErrors?.amountUah}>
        <Input id="new-amount" name="amountUah" inputMode="decimal" />
      </FormField>
      <div className="md:col-span-3">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
        <Button type="submit" disabled={pending}>
          {t('createDraft')}
        </Button>
      </div>
    </form>
  );
}
