'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { FormField, NativeSelect } from '@/components/form-field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { saveAssignment, type AssignmentFormState } from '@/server/actions/assignments';
import { BillingFields, PayFields } from './terms-fields';

export type AssignmentCore = {
  id?: string;
  personId: string;
  isInternal: boolean;
  contractId: string | null;
  sowRef: string | null;
  roleTitle: string | null;
  fte: string;
  startsOn: string;
  endsOn: string | null;
};

type Props = {
  assignment: AssignmentCore;
  personName: string;
  contracts: { value: string; label: string }[];
};

/**
 * New assignment: core fields plus the «Клієнту» / «Людині» blocks (spec 6.3). In edit mode only
 * the core fields are editable; terms change through new versions on the assignment page.
 */
export function AssignmentForm({ assignment, personName, contracts }: Props) {
  const [state, action, pending] = useActionState<AssignmentFormState, FormData>(
    saveAssignment,
    null,
  );
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  const [internal, setInternal] = useState(assignment.isInternal);
  const editing = Boolean(assignment.id);

  return (
    <form action={action} className="flex max-w-4xl flex-col gap-6">
      {editing ? (
        <input type="hidden" name="id" value={assignment.id} />
      ) : (
        <input type="hidden" name="personId" value={assignment.personId} />
      )}
      {state && !state.ok && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error.message}</AlertDescription>
        </Alert>
      )}
      <p className="text-sm text-muted-foreground">
        Людина: <span className="font-medium text-foreground">{personName}</span>
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {!editing && (
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              name="isInternal"
              checked={internal}
              onChange={(e) => {
                setInternal(e.target.checked);
              }}
            />
            Внутрішнє залучення (CEO/CTO на власній компанії, без клієнта)
          </label>
        )}
        {!editing && !internal && (
          <FormField
            label="Договір (SOW / Annex клієнта)"
            htmlFor="contractId"
            className="md:col-span-2"
            error={errors?.contractId}
          >
            <NativeSelect
              id="contractId"
              name="contractId"
              defaultValue={assignment.contractId ?? ''}
              placeholder="Оберіть договір"
              options={contracts}
            />
          </FormField>
        )}
        <FormField label="Роль" htmlFor="roleTitle" error={errors?.roleTitle}>
          <Input
            id="roleTitle"
            name="roleTitle"
            defaultValue={assignment.roleTitle ?? ''}
            placeholder="Senior Backend Developer"
          />
        </FormField>
        <FormField label="SOW / Annex" htmlFor="sowRef" error={errors?.sowRef}>
          <Input
            id="sowRef"
            name="sowRef"
            defaultValue={assignment.sowRef ?? ''}
            placeholder="SOW #1"
          />
        </FormField>
        <FormField label="FTE" htmlFor="fte" error={errors?.fte}>
          <Input id="fte" name="fte" inputMode="decimal" defaultValue={assignment.fte} />
        </FormField>
        <div />
        <FormField label="Початок" htmlFor="startsOn" error={errors?.startsOn}>
          <Input
            id="startsOn"
            name="startsOn"
            type="date"
            required
            defaultValue={assignment.startsOn}
          />
        </FormField>
        <FormField
          label="Завершення"
          htmlFor="endsOn"
          hint="Порожньо — без дати завершення"
          error={errors?.endsOn}
        >
          <Input id="endsOn" name="endsOn" type="date" defaultValue={assignment.endsOn ?? ''} />
        </FormField>
      </div>

      {!editing && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Клієнту</CardTitle>
            </CardHeader>
            <CardContent>
              <BillingFields
                prefix="billing."
                errors={errors}
                defaults={{
                  type: internal ? 'none' : 'hourly',
                  rate: '',
                  currency: 'USD',
                  prorationPolicy: 'full_month',
                  invoiceChannel: 'fiat',
                }}
                key={internal ? 'internal' : 'client'}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Людині</CardTitle>
            </CardHeader>
            <CardContent>
              <PayFields
                prefix="pay."
                errors={errors}
                defaults={{
                  type: 'fixed',
                  amount: '',
                  currency: 'USD',
                  payoutMethod: 'fiat',
                  releasePolicy: 'on_payment_or_due',
                  graceDays: 0,
                }}
              />
            </CardContent>
          </Card>
        </div>
      )}
      {!editing && (
        <p className="text-sm text-muted-foreground">
          Перші версії умов діятимуть з першого числа місяця початку. Зміни пізніше — лише новою
          версією.
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти'}
        </Button>
        <Button
          variant="ghost"
          render={
            <Link
              href={
                editing
                  ? `/people/assignments/${assignment.id ?? ''}`
                  : `/people/${assignment.personId}`
              }
            />
          }
        >
          Скасувати
        </Button>
      </div>
    </form>
  );
}
