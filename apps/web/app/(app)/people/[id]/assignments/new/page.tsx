import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { contractOptions } from '@/server/services/assignments';
import { annexOptions } from '@/server/services/contracts/annexes';
import { getPerson } from '@/server/services/people';
import { AssignmentForm } from '../../../assignments/assignment-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { FormCard } from '@/components/v2/form-card';

export const generateMetadata = pageTitle('newAssignment');

export default async function NewAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const t = await getTranslations('assignment');
  const { id } = await params;
  const person = await getPerson.run(ctx, { id });
  if (person.isErr()) notFound();
  const contracts = (await contractOptions.run(ctx, {})).unwrapOr([]);
  const annexes = (await annexOptions.run(ctx, {})).unwrapOr([]);

  const v2 = (await getUiPrefs()).version === 'v2';
  return (
    <div className="flex flex-col gap-6">
      {v2 ? (
        <PageHeader
          title={t('newTitle')}
          crumbParents={[{ label: person.value.fullName, href: `/people/${id}` }]}
        />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{t('newTitle')}</h1>
        </>
      )}
      <FormCard>
        <AssignmentForm
          personName={person.value.fullName}
          contracts={contracts}
          annexes={annexes}
          assignment={{
            personId: id,
            isInternal: false,
            contractId: null,
            annexId: null,
            sowRef: null,
            roleTitle: person.value.position,
            fte: '1',
            startsOn: ctx.today,
            endsOn: null,
          }}
        />
      </FormCard>
    </div>
  );
}
