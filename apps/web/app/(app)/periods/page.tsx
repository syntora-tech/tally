import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Періоди · Tally' };

export default async function PeriodsPage() {
  await requireRole(FINANCE_ROLES);
  return (
    <ModulePlaceholder
      title="Періоди"
      description="Місячне закриття: години, розрахунок, коригування."
      stage="2"
    />
  );
}
