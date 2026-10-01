import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { ClientForm } from '../client-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('newClient');

export default async function NewClientPage() {
  await requireRole(FINANCE_ROLES);
  const t = await getTranslations('clients');
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('newTitle')}</h1>
      <ClientForm />
    </div>
  );
}
