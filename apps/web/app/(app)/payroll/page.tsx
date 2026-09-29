import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Виплати · Tally' };

export default async function PayrollPage() {
  await requireRole(FINANCE_ROLES);
  return (
    <ModulePlaceholder
      title="Виплати"
      description="Черга виплат, pay-when-paid та акти ФОП."
      stage="3"
    />
  );
}
