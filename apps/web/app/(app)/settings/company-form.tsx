'use client';

import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saveCompanyAction, type CompanyFormState } from '@/server/actions/company';

export type CompanyValues = {
  nameEn: string;
  nameUa: string;
  legalCode: string | null;
  addressEn: string | null;
  addressUa: string | null;
  directorEn: string | null;
  directorUa: string | null;
  bankDetailsEn: string | null;
  bankDetailsUa: string | null;
};

export function CompanyForm({ company }: { company: CompanyValues | null }) {
  const [state, action, pending] = useActionState<CompanyFormState, FormData>(
    saveCompanyAction,
    null,
  );
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) toast.success('Реквізити збережено');
    else if (state) toast.error(state.error.message);
  }, [state]);

  const text = (name: keyof CompanyValues, label: string, placeholder?: string) => (
    <FormField label={label} htmlFor={name} error={errors?.[name]}>
      <Input id={name} name={name} defaultValue={company?.[name] ?? ''} placeholder={placeholder} />
    </FormField>
  );
  const area = (name: keyof CompanyValues, label: string) => (
    <FormField label={label} htmlFor={name} error={errors?.[name]}>
      <Textarea id={name} name={name} rows={4} defaultValue={company?.[name] ?? ''} />
    </FormField>
  );

  return (
    <form action={action} className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
      {text('nameEn', 'Назва (EN)', 'LLC "SYNTORA"')}
      {text('nameUa', 'Назва (UA)', 'ТОВ «СІНТОРА»')}
      {text('legalCode', 'ЄДРПОУ')}
      <div />
      {area('addressEn', 'Адреса (EN)')}
      {area('addressUa', 'Адреса (UA)')}
      {text('directorEn', 'Директор (EN)')}
      {text('directorUa', 'Директор (UA)')}
      {area('bankDetailsEn', 'Банківські реквізити (EN)')}
      {area('bankDetailsUa', 'Банківські реквізити (UA)')}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Зберігаємо…' : 'Зберегти реквізити'}
        </Button>
      </div>
    </form>
  );
}
