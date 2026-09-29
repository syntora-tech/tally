import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { OWNER_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Налаштування · Tally' };

export default async function SettingsPage() {
  await requireRole(OWNER_ROLES);
  return (
    <ModulePlaceholder
      title="Налаштування"
      description="Реквізити компанії, календар, нумерація, шаблони, користувачі."
      stage="1+"
    />
  );
}
