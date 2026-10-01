'use client';

import { useTranslations } from 'next-intl';
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
  const t = useTranslations('settingsForms');
  const tc = useTranslations('common');

  useEffect(() => {
    if (state?.ok) toast.success(t('companySaved'));
    else if (state) toast.error(state.error.message);
  }, [state, t]);

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
      {text('nameEn', t('nameEn'), 'LLC "SYNTORA"')}
      {text('nameUa', t('nameUa'), 'ТОВ «СІНТОРА»')}
      {text('legalCode', t('legalCode'))}
      <div />
      {area('addressEn', t('addressEn'))}
      {area('addressUa', t('addressUa'))}
      {text('directorEn', t('directorEn'))}
      {text('directorUa', t('directorUa'))}
      {area('bankDetailsEn', t('bankEn'))}
      {area('bankDetailsUa', t('bankUa'))}
      <div className="md:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? tc('saving') : t('saveCompany')}
        </Button>
      </div>
    </form>
  );
}
