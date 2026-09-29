import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { ALL_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Відрядження · Tally' };

export default async function TripsPage() {
  await requireRole(ALL_ROLES);
  return (
    <ModulePlaceholder
      title="Відрядження"
      description="Поїздки, витрати з чеками та компенсації."
      stage="5"
    />
  );
}
