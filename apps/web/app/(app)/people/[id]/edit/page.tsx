import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPerson } from '@/server/services/people';
import { PersonForm } from '../../person-form';
import { pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { FormCard } from '@/components/v2/form-card';

export const generateMetadata = pageTitle('edit');

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getPerson.run(ctx, { id });
  if (result.isErr()) notFound();
  const p = result.value;

  const v2 = (await getUiPrefs()).version === 'v2';
  const tc = await getTranslations('common');
  return (
    <div className="flex flex-col gap-6">
      {v2 ? (
        <PageHeader
          title={p.fullName}
          crumb={tc('editing')}
          crumbParents={[{ label: p.fullName, href: `/people/${p.id}` }]}
        />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{p.fullName}</h1>
        </>
      )}
      <FormCard>
        <PersonForm
          person={{
            id: p.id,
            fullName: p.fullName,
            displayName: p.displayName,
            position: p.position,
            seniority: p.seniority,
            stack: p.stack,
            domains: p.domains,
            marketRateUsd: p.marketRateUsd,
            allocation: p.allocation,
            availabilityFrom: p.availabilityFrom,
            location: p.location,
            timezone: p.timezone,
            contactOwner: p.contactOwner,
            status: p.status,
            notes: p.notes,
          }}
        />
      </FormCard>
    </div>
  );
}
