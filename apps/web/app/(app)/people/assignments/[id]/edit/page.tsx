import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getAssignment } from '@/server/services/assignments';
import { AssignmentForm } from '../../assignment-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('editAssignment');

export default async function EditAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const t = await getTranslations('assignment');
  const { id } = await params;
  const result = await getAssignment.run(ctx, { id });
  if (result.isErr()) notFound();
  const { assignment: a, personName } = result.value;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('editTitle')}</h1>
      <AssignmentForm
        personName={personName}
        contracts={[]}
        assignment={{
          id: a.id,
          personId: a.personId,
          isInternal: a.isInternal,
          contractId: a.contractId,
          sowRef: a.sowRef,
          roleTitle: a.roleTitle,
          fte: a.fte,
          startsOn: a.startsOn,
          endsOn: a.endsOn,
        }}
      />
    </div>
  );
}
