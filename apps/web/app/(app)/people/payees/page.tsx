import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listPayees } from '@/server/services/payees';
import { PayeesTable } from './payees-table';

export const metadata: Metadata = { title: 'Одержувачі · Tally' };

export default async function PayeesPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const result = await listPayees.run(ctx, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Одержувачі виплат</h1>
          <p className="text-muted-foreground">ФОП, крипто-гаманці та інші одержувачі</p>
        </div>
        <Button render={<Link href="/people/payees/new" />}>Додати одержувача</Button>
      </div>
      {result.isErr() ? (
        <p className="text-destructive">{result.error.message}</p>
      ) : (
        <PayeesTable rows={result.value} />
      )}
    </div>
  );
}
