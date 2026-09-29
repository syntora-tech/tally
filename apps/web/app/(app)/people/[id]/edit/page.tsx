import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPerson } from '@/server/services/people';
import { PersonForm } from '../../person-form';

export const metadata: Metadata = { title: 'Редагування · Tally' };

export default async function EditPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getPerson.run(ctx, { id });
  if (result.isErr()) notFound();
  const p = result.value;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{p.fullName}</h1>
      <PersonForm
        person={{
          id: p.id,
          fullName: p.fullName,
          displayName: p.displayName,
          position: p.position,
          seniority: p.seniority,
          stack: p.stack,
          domains: p.domains,
          marketRateUsd: p.marketRateUsd,
          allocation: p.allocation,
          availabilityFrom: p.availabilityFrom,
          location: p.location,
          timezone: p.timezone,
          contactOwner: p.contactOwner,
          status: p.status,
          notes: p.notes,
        }}
      />
    </div>
  );
}
