'use client';

import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createActAction,
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
  const error = useResult(state, 'Чернетку збережено');
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={props.id} />
      <FormField label="Дата акту" htmlFor="act-date" error={error?.fieldErrors?.actDate}>
        <Input id="act-date" name="actDate" type="date" defaultValue={props.actDate} />
      </FormField>
      {props.editableAmount && (
        <FormField label="Сума, UAH" htmlFor="act-amount" error={error?.fieldErrors?.amountUah}>
          <Input
            id="act-amount"
            name="amountUah"
            inputMode="decimal"
            defaultValue={props.amountUah}
          />
        </FormField>
      )}
      <FormField label="Причина неробочої дати (власник)" htmlFor="act-override">
        <Input
          id="act-override"
          name="dateOverrideReason"
          defaultValue={props.dateOverrideReason ?? ''}
          className="w-72"
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        Зберегти
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export function IssueActForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(issueActAction, null);
  const error = useResult(state, 'Акт випущено');
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <div>
        <Button type="submit" disabled={pending}>
          Випустити акт і присвоїти номер
        </Button>
      </div>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

export function VoidActForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(voidActAction, null);
  const error = useResult(state, 'Акт анульовано');
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField label="Причина анулювання" htmlFor="act-void" error={error?.fieldErrors?.reason}>
        <Input id="act-void" name="reason" required className="w-80" />
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

export function SignedUrlForm({ id, value }: { id: string; value: string | null }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(setSignedUrlAction, null);
  const error = useResult(state, 'Посилання збережено');
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <FormField
        label="Підписаний акт у Вчасно"
        htmlFor="act-signed"
        error={error?.fieldErrors?.signedUrl}
      >
        <Input
          id="act-signed"
          name="signedUrl"
          defaultValue={value ?? ''}
          placeholder="https://vchasno.ua/…"
          className="w-96"
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        Зберегти
      </Button>
    </form>
  );
}

export function NewActForm(props: { contracts: { id: string; label: string }[]; today: string }) {
  const [state, action, pending] = useActionState<ActFormState, FormData>(createActAction, null);
  const error = useResult(state, 'Акт створено');
  return (
    <form action={action} className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-3">
      <FormField
        label="Договір ФОП"
        htmlFor="new-contract"
        error={error?.fieldErrors?.contractId}
        className="md:col-span-2"
      >
        <NativeSelect
          id="new-contract"
          name="contractId"
          placeholder="Оберіть договір"
          options={props.contracts.map((c) => ({ value: c.id, label: c.label }))}
        />
      </FormField>
      <FormField label="Тип" htmlFor="new-type">
        <NativeSelect
          id="new-type"
          name="type"
          defaultValue="reimbursement"
          options={[
            { value: 'reimbursement', label: 'Компенсація' },
            { value: 'other', label: 'Інше' },
          ]}
        />
      </FormField>
      <FormField label="Дата акту" htmlFor="new-date" error={error?.fieldErrors?.actDate}>
        <Input id="new-date" name="actDate" type="date" defaultValue={props.today} />
      </FormField>
      <FormField label="Період з" htmlFor="new-from">
        <Input id="new-from" name="periodFrom" type="date" />
      </FormField>
      <FormField label="по" htmlFor="new-to">
        <Input id="new-to" name="periodTo" type="date" />
      </FormField>
      <FormField label="Сума, UAH" htmlFor="new-amount" error={error?.fieldErrors?.amountUah}>
        <Input id="new-amount" name="amountUah" inputMode="decimal" />
      </FormField>
      <div className="md:col-span-3">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
        <Button type="submit" disabled={pending}>
          Створити чернетку
        </Button>
      </div>
    </form>
  );
}
