import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Інвойси · Tally' };

export default async function InvoicesPage() {
  await requireRole(FINANCE_ROLES);
  return (
    <ModulePlaceholder
      title="Інвойси"
      description="Інвойси клієнтам, випуск, оплати та дебіторка."
      stage="2"
    />
  );
}
