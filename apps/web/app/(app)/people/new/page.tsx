import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { PersonForm } from '../person-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { FormCard } from '@/components/v2/form-card';

export const generateMetadata = pageTitle('newPerson');

export default async function NewPersonPage() {
  await requireRole(FINANCE_ROLES);
  const t = await getTranslations('personForm');
  const v2 = (await getUiPrefs()).version === 'v2';
  return (
    <div className="flex flex-col gap-6">
      {v2 ? (
        <PageHeader title={t('newTitle')} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{t('newTitle')}</h1>
        </>
      )}
      <FormCard>
        <PersonForm />
      </FormCard>
    </div>
  );
}
