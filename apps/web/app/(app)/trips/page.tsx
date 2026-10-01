import { ModulePlaceholder } from '@/components/module-placeholder';
import { ALL_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('trips');

export default async function TripsPage() {
  await requireRole(ALL_ROLES);
  const t = await getTranslations('trips');
  return <ModulePlaceholder title={t('title')} description={t('description')} stage="5" />;
}
