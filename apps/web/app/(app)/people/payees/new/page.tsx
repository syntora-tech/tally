import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { PayeeForm } from '../payee-form';
import { peopleOptions } from '../people-options';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';

export const generateMetadata = pageTitle('newPayee');

export default async function NewPayeePage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { personId } = await searchParams;
  const t = await getTranslations('payees');
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
      <PayeeForm
        people={await peopleOptions(ctx)}
        {...(personId ? { defaultPersonId: personId } : {})}
      />
    </div>
  );
}
