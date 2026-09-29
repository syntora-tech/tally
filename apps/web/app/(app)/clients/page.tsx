import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listClients } from '@/server/services/clients';
import { ClientsTable } from './clients-table';

export const metadata: Metadata = { title: 'Клієнти · Tally' };

export default async function ClientsPage() {
  const ctx = await requireRole(ALL_ROLES);
  const result = await listClients.run(ctx, {});
  const canWrite = FINANCE_ROLES.includes(ctx.actor.role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Клієнти</h1>
          <p className="text-muted-foreground">Клієнти, договори та залучені люди</p>
        </div>
        {canWrite && <Button render={<Link href="/clients/new" />}>Додати клієнта</Button>}
      </div>
      {result.isErr() ? (
        <p className="text-destructive">{result.error.message}</p>
      ) : (
        <ClientsTable rows={result.value} />
      )}
    </div>
  );
}
