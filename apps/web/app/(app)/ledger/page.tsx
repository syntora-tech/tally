import type { Metadata } from 'next';
import { ModulePlaceholder } from '@/components/module-placeholder';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';

export const metadata: Metadata = { title: 'Ledger · Tally' };

export default async function LedgerPage() {
  await requireRole(FINANCE_ROLES);
  return (
    <ModulePlaceholder
      title="Ledger"
      description="Рахунки, транзакції, обміни та звірка залишків."
      stage="3–4"
    />
  );
}
