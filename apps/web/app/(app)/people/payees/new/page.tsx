import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { PayeeForm } from '../payee-form';
import { peopleOptions } from '../people-options';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('newPayee');

export default async function NewPayeePage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { personId } = await searchParams;
  const t = await getTranslations('payees');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('newTitle')}</h1>
      <PayeeForm
        people={await peopleOptions(ctx)}
        {...(personId ? { defaultPersonId: personId } : {})}
      />
    </div>
  );
}
