import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { searchPeople } from '@/server/services/people';
import { pageTitle } from '@/server/i18n';
import { TripForm } from '../trip-form';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { FormCard } from '@/components/v2/form-card';

export const generateMetadata = pageTitle('newTrip');

export default async function NewTripPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const [people, t] = await Promise.all([searchPeople.run(ctx, {}), getTranslations('trips')]);
  const v2 = (await getUiPrefs()).version === 'v2';
  return (
    <div className="flex flex-col gap-6">
      <div>
        {v2 ? (
          <PageHeader title={t('new')} />
        ) : (
          <>
            <Link href="/trips" className="text-sm text-muted-foreground hover:underline">
              ← {t('title')}
            </Link>
            <h1 className="text-2xl font-semibold">{t('new')}</h1>
          </>
        )}
      </div>
      <FormCard>
        <TripForm
          people={people
            .unwrapOr([])
            .filter((p) => p.status !== 'inactive')
            .map((p) => ({ id: p.id, name: p.fullName }))}
        />
      </FormCard>
    </div>
  );
}
