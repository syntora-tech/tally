import type { Metadata } from 'next';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { PersonForm } from '../person-form';

export const metadata: Metadata = { title: 'Нова людина · Tally' };

export default async function NewPersonPage() {
  await requireRole(FINANCE_ROLES);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Нова людина</h1>
      <PersonForm />
    </div>
  );
}
