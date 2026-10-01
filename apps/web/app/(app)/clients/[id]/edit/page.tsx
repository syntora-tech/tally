import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getClient } from '@/server/services/clients';
import { ClientForm } from '../../client-form';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('editClient');

type Contact = { name: string; role?: string; email?: string; phone?: string };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getClient.run(ctx, { id });
  if (result.isErr()) notFound();
  const c = result.value.client;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{c.shortName ?? c.legalName}</h1>
      <ClientForm
        client={{
          id: c.id,
          legalName: c.legalName,
          shortName: c.shortName,
          address: c.address,
          country: c.country,
          bankDetails: c.bankDetails,
          contacts: c.contacts as Contact[],
          defaultCurrency: c.defaultCurrency,
        }}
      />
    </div>
  );
}
