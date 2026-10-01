import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { PersonForm } from '../person-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('newPerson');

export default async function NewPersonPage() {
  await requireRole(FINANCE_ROLES);
  const t = await getTranslations('personForm');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('newTitle')}</h1>
      <PersonForm />
    </div>
  );
}
