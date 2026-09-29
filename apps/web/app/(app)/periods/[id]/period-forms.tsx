'use client';

import { useActionState, useEffect } from 'react';
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
  closePeriodAction,
  reopenPeriodAction,
  saveHoursAction,
  updatePeriodAction,
  uploadHoursCsvAction,
  type PeriodFormState,
} from '@/server/actions/periods';

function useResult(state: PeriodFormState, success: string) {
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

export function ParamsForm(props: {
  periodId: string;
  workHours: string;
  referenceFx: string | null;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    updatePeriodAction,
    null,
  );
  const error = useResult(state, 'Параметри збережено');
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="periodId" value={props.periodId} />
      <FormField label="Норма, год" htmlFor="workHours" error={error?.fieldErrors?.workHours}>
        <Input
          id="workHours"
          name="workHours"
          defaultValue={props.workHours}
          disabled={props.disabled}
          className="w-32"
        />
      </FormField>
      <FormField label="Довідковий курс USD→UAH" htmlFor="referenceFxUsdUah">
        <Input
          id="referenceFxUsdUah"
          name="referenceFxUsdUah"
          defaultValue={props.referenceFx ?? ''}
          disabled={props.disabled}
          className="w-40"
        />
      </FormField>
      {!props.disabled && (
        <Button type="submit" variant="outline" disabled={pending}>
          Зберегти
        </Button>
      )}
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}

export type HoursRow = {
  assignmentId: string;
  personName: string;
  clientName: string | null;
  roleTitle: string | null;
  billing: string;
  hours: string | null;
};

export function HoursForm({
  periodId,
  rows,
  disabled,
}: {
  periodId: string;
  rows: HoursRow[];
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(saveHoursAction, null);
  const error = useResult(state, 'Години збережено');
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="periodId" value={periodId} />
      <ErrorAlert message={error?.message} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Людина</TableHead>
            <TableHead>Клієнт</TableHead>
            <TableHead>Роль</TableHead>
            <TableHead>Умови клієнту</TableHead>
            <TableHead className="w-32">Години</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.assignmentId}>
              <TableCell>{r.personName}</TableCell>
              <TableCell>{r.clientName ?? 'внутрішнє'}</TableCell>
              <TableCell className="text-muted-foreground">{r.roleTitle ?? '—'}</TableCell>
              <TableCell className="text-muted-foreground">{r.billing}</TableCell>
              <TableCell>
                <Input
                  name={`hours.${r.assignmentId}`}
                  aria-label={`Години: ${r.personName}, ${r.clientName ?? 'внутрішнє'}`}
                  inputMode="decimal"
                  defaultValue={r.hours ?? ''}
                  disabled={disabled}
                  className="h-8 w-24"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!disabled && (
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? 'Зберігаємо…' : 'Зберегти години'}
        </Button>
      )}
    </form>
  );
}

export function HoursCsvForm({ periodId }: { periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    uploadHoursCsvAction,
    null,
  );
  const error = useResult(state, 'Години з CSV імпортовано');
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="periodId" value={periodId} />
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        aria-label="CSV з годинами"
        className="text-sm"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        Імпортувати CSV
      </Button>
      <ErrorAlert message={error?.message} />
    </form>
  );
}

export function CloseForm({ periodId }: { periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    closePeriodAction,
    null,
  );
  const error = useResult(state, 'Період закрито, чернетки інвойсів створено');
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm('Закрити період? Години стануть незмінними, буде створено чернетки інвойсів.'))
          e.preventDefault();
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="periodId" value={periodId} />
      <ErrorAlert message={error?.message} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Закриваємо…' : 'Закрити період'}
      </Button>
    </form>
  );
}

export function ReopenForm({ periodId }: { periodId: string }) {
  const [state, action, pending] = useActionState<PeriodFormState, FormData>(
    reopenPeriodAction,
    null,
  );
  const error = useResult(state, 'Період відкрито');
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="periodId" value={periodId} />
      <FormField label="Причина відкриття" htmlFor="reason" error={error?.fieldErrors?.reason}>
        <Input id="reason" name="reason" required className="w-80" />
      </FormField>
      <Button type="submit" variant="outline" disabled={pending}>
        Відкрити період знову
      </Button>
      <div className="w-full">
        <ErrorAlert message={error && !error.fieldErrors ? error.message : undefined} />
      </div>
    </form>
  );
}
