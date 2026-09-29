import type { Metadata } from 'next';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { ClientForm } from '../client-form';

export const metadata: Metadata = { title: 'Новий клієнт · Tally' };

export default async function NewClientPage() {
  await requireRole(FINANCE_ROLES);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Новий клієнт</h1>
      <ClientForm />
    </div>
  );
}
