import type { Metadata } from 'next';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { PayeeForm } from '../payee-form';
import { peopleOptions } from '../people-options';

export const metadata: Metadata = { title: 'Новий одержувач · Tally' };

export default async function NewPayeePage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { personId } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Новий одержувач</h1>
      <PayeeForm
        people={await peopleOptions(ctx)}
        {...(personId ? { defaultPersonId: personId } : {})}
      />
    </div>
  );
}
