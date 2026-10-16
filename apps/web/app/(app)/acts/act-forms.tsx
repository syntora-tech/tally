'use client';

import { useTranslations } from 'next-intl';
import { HelpTip } from '@/components/v2/help-tip';
import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileInput } from '@/components/file-input';
import {
  mergeReimbursementActsAction,
  attachSignedActAction,
  createActAction,
  issueActWithDocumentAction,
  deleteDraftActAction,
  issueActAction,
  saveActDraftAction,
  setSignedUrlAction,
  restoreActAction,
  reviseActAction,
  voidActAction,
  type ActFormState,
} from '@/server/actions/acts';
import { useCloseOnSuccess } from '@/components/v2/form-dialog';
import { useIsV2 } from '@/components/v2/ui-version';

function useResult(state: ActFormState, success: string) {
  useCloseOnSuccess(state);
  useEffect(() => {
    if (state?.ok) toast.success(success);
  }, [state, success]);
  return state && !state.ok ? state.error : null;
}

/** v2: the owner's reason for a non-working date stays folded until it is needed. */
function OverrideReason({ id, defaultValue }: { id: string; defaultValue: string | null }) {
  const t = useTranslations('actForms');
  const [open, setOpen] = useState(Boolean(defaultValue));
  if (!open) {
    return (
      <button
        type="button"
        className="self-start text-sm font-medium text-link hover:underline"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('v2.addOverride')}
      </button>
    );
  }
  return (
    <FormField label={t('nonWorkingReason')} htmlFor={id}>
      <Input id={id} name="dateOverrideReason" defaultValue={defaultValue ?? ''} />
    </FormField>
  );
}

function ErrorAlert({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

// "Issue" submits the draft form, so the dates typed there are saved before the number is given.
const DRAFT_FORM_ID = 'act-draft-form';

export function ActDraftForm(props: {
  id: string;
  actDate: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  amountUah: string;
  editableAmount: boolean;
  dateOverrideReason: string | null;
}) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(saveActDraftAction, null);
  const t = useTranslations('actForms');
  const tc = useTranslations('common');
  const error = useResult(state, t('draftSaved'));
  if (useIsV2()) {
    return (
      <form id={DRAFT_FORM_ID} action={action} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={props.id} />
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <FormField label={t('actDate')} htmlFor="act-date" error={error?.fieldErrors?.actDate}>
            <Input id="act-date" name="actDate" type="date" defaultValue={props.actDate} />
          </FormField>
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:row-start-2">
            <FormField
              label={t('v2.periodFrom')}
              htmlFor="act-period-from"
              error={error?.fieldErrors?.periodFrom}
            >
              <Input
                id="act-period-from"
                name="periodFrom"
                type="date"
                defaultValue={props.periodFrom ?? ''}
              />
            </FormField>
            <FormField
              label={t('v2.periodTo')}
              htmlFor="act-period-to"
              error={error?.fieldErrors?.periodTo}
            >
              <Input
                id="act-period-to"
                name="periodTo"
                type="date"
                defaultValue={props.periodTo ?? ''}
              />
            </FormField>
          </div>
          {props.editableAmount ? (
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
          ) : (
            <span />
          )}
          <Button type="submit" variant="outline" disabled={pending}>
            {t('v2.saveDraft')}
          </Button>
        </div>
        <OverrideReason id="act-override" defaultValue={props.dateOverrideReason} />
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </form>
    );
  }
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

export function IssueActForm({ id, nextNumber }: { id: string; nextNumber?: string | null }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(issueActAction, null);
  const t = useTranslations('actForms');
  const tc = useTranslations('common');
  const error = useResult(state, t('issued'));
  if (useIsV2()) {
    return (
      <form action={action} className="flex flex-col gap-2 border-t pt-4">
        <input type="hidden" name="id" value={id} />
        <div className="flex flex-wrap items-center gap-3">
          {nextNumber ? (
            <span className="flex items-center gap-1.5 text-sm" data-testid="act-next-number">
              {t.rich('v2.nextNumber', {
                number: nextNumber,
                b: (chunks) => <b>{chunks}</b>,
              })}
              <HelpTip label={tc('help')}>{t('v2.nextNumberHelp')}</HelpTip>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">{t('v2.numberHint')}</span>
          )}
          <Button
            type="submit"
            form={DRAFT_FORM_ID}
            formAction={action}
            disabled={pending}
            className="ml-auto"
          >
            {t('issue')}
          </Button>
        </div>
        <ErrorAlert message={error?.message} />
      </form>
    );
  }
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

export function ReviseActForm(props: {
  id: string;
  actDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  dateOverrideReason: string | null;
}) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(reviseActAction, null);
  const t = useTranslations('actForms');
  const error = useResult(state, t('revised'));
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={props.id} />
      <p className="text-sm text-muted-foreground">{t('reviseHint')}</p>
      <FormField label={t('actDate')} htmlFor="act-revise-date" error={error?.fieldErrors?.actDate}>
        <Input id="act-revise-date" name="actDate" type="date" defaultValue={props.actDate} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label={t('v2.periodFrom')}
          htmlFor="act-revise-from"
          error={error?.fieldErrors?.periodFrom}
        >
          <Input
            id="act-revise-from"
            name="periodFrom"
            type="date"
            defaultValue={props.periodFrom ?? ''}
          />
        </FormField>
        <FormField
          label={t('v2.periodTo')}
          htmlFor="act-revise-to"
          error={error?.fieldErrors?.periodTo}
        >
          <Input
            id="act-revise-to"
            name="periodTo"
            type="date"
            defaultValue={props.periodTo ?? ''}
          />
        </FormField>
      </div>
      <OverrideReason id="act-revise-override" defaultValue={props.dateOverrideReason} />
      <FormField
        label={t('reviseReason')}
        htmlFor="act-revise-reason"
        error={error?.fieldErrors?.reason}
      >
        <Input id="act-revise-reason" name="reason" required />
      </FormField>
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t('revise')}
        </Button>
      </div>
    </form>
  );
}

export function RestoreActForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(restoreActAction, null);
  const t = useTranslations('actForms');
  const error = useResult(state, t('restored'));
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <p className="w-full text-sm text-muted-foreground">{t('restoreHint')}</p>
      <FormField
        label={t('restoreReason')}
        htmlFor="act-restore"
        error={error?.fieldErrors?.reason}
      >
        <Input id="act-restore" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" disabled={pending}>
        {t('restore')}
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
  if (useIsV2()) {
    return (
      <form action={action} className="flex flex-col gap-1.5">
        <input type="hidden" name="id" value={id} />
        <FormField
          label={t('signedLink')}
          htmlFor="act-signed"
          error={error?.fieldErrors?.signedUrl}
        >
          <div className="flex gap-2">
            <Input
              id="act-signed"
              name="signedUrl"
              defaultValue={value ?? ''}
              placeholder="https://vchasno.ua/…"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              {tc('save')}
            </Button>
          </div>
        </FormField>
      </form>
    );
  }
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
  if (useIsV2()) {
    return (
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField
            label={t('ownNumber')}
            htmlFor="act-own-number"
            error={error?.fieldErrors?.number}
          >
            <Input id="act-own-number" name="number" required />
          </FormField>
          <FormField
            label={t('ownDate')}
            htmlFor="act-own-date"
            error={error?.fieldErrors?.actDate}
          >
            <Input id="act-own-date" name="actDate" type="date" defaultValue={actDate} />
          </FormField>
        </div>
        <OverrideReason id="act-own-override" defaultValue={null} />
        <FormField label={t('ownFile')} htmlFor="act-own-file" error={error?.fieldErrors?.file}>
          <FileInput id="act-own-file" name="file" accept="application/pdf" required />
        </FormField>
        <FormField
          label={t('signedLink')}
          htmlFor="act-own-link"
          error={error?.fieldErrors?.signedUrl}
        >
          <Input id="act-own-link" name="signedUrl" placeholder="https://vchasno.ua/…" />
        </FormField>
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="signed" className="size-4 accent-foreground" />
            {t('ownSigned')}
          </label>
          <Button type="submit" disabled={pending} className="ml-auto">
            {t('ownIssue')}
          </Button>
        </div>
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </form>
    );
  }
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
        <FileInput id="act-own-file" name="file" accept="application/pdf" required />
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
  if (useIsV2()) {
    return (
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <FormField
          label={t('signedFile')}
          htmlFor="act-signed-file"
          error={error?.fieldErrors?.file}
        >
          <FileInput id="act-signed-file" name="file" accept="application/pdf" required />
        </FormField>
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
        <div className="flex">
          <Button type="submit" variant="outline" disabled={pending} className="ml-auto">
            {t('signedFileSave')}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label={t('signedFile')} htmlFor="act-signed-file" error={error?.fieldErrors?.file}>
        <FileInput id="act-signed-file" name="file" accept="application/pdf" required />
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

/** One act for several trips (A-108): another draft trip act of this contract joins this one. */
export function MergeTripActsForm({
  id,
  others,
}: {
  id: string;
  others: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(
    mergeReimbursementActsAction,
    null,
  );
  const t = useTranslations('actForms');
  const error = useResult(state, t('v2.tripsMerged'));
  const [picked, setPicked] = useState('');
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-muted-foreground">{t('v2.mergeTripsHint')}</p>
      <div
        role="radiogroup"
        aria-label={t('v2.mergeWith')}
        className="flex flex-col divide-y rounded-lg border"
      >
        {others.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/50"
          >
            <input
              type="radio"
              name="otherId"
              value={o.id}
              checked={picked === o.id}
              onChange={() => {
                setPicked(o.id);
              }}
              className="accent-foreground"
            />
            {o.label}
          </label>
        ))}
      </div>
      <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={pending || !picked}>
          {t('v2.mergeTrips')}
        </Button>
      </div>
    </form>
  );
}
