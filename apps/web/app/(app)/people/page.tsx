import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { ALL_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Люди · Tally' };

export default async function PeoplePage() {
  await requireRole(ALL_ROLES);
  return (
    <ModulePlaceholder
      title="Люди"
      description="Пул спеціалістів (Bench), профілі, CV та залучення."
      stage="1"
    />
  );
}
