import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { ALL_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Документи · Tally' };

export default async function DocumentsPage() {
  await requireRole(ALL_ROLES);
  return (
    <ModulePlaceholder
      title="Документи"
      description="Реєстр документів і їх прив’язки до сутностей."
      stage="1"
    />
  );
}
