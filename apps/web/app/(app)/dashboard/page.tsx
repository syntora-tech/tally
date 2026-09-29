import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { ALL_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Огляд · Tally' };

export default async function DashboardPage() {
  await requireRole(ALL_ROLES);
  return (
    <ModulePlaceholder
      title="Огляд"
      description="Залишки, дебіторка, зобов’язання перед людьми, календар дедлайнів і маржа."
      stage="4"
    />
  );
}
