import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { ALL_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Клієнти · Tally' };

export default async function ClientsPage() {
  await requireRole(ALL_ROLES);
  return (
    <ModulePlaceholder
      title="Клієнти"
      description="Клієнти, контракти, SOW та умови залучень."
      stage="1"
    />
  );
}
