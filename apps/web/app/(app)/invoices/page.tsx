import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { INVOICE_STATUS_LABELS } from '@/lib/labels';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { INVOICE_STATUSES, listInvoices } from '@/server/services/invoices';
import { InvoicesTable } from './invoices-table';

export const metadata: Metadata = { title: 'Інвойси · Tally' };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { status = '' } = await searchParams;
  const result = await listInvoices.run(ctx, { status });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Інвойси</h1>
        <p className="text-muted-foreground">
          Чернетки створюються при закритті періоду; номер присвоюється при випуску
        </p>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Фільтр за статусом">
        {['', ...INVOICE_STATUSES].map((s) => (
          <Button
            key={s || 'all'}
            size="sm"
            variant={s === status ? 'default' : 'outline'}
            render={<Link href={s ? `/invoices?status=${s}` : '/invoices'} />}
          >
            {s ? INVOICE_STATUS_LABELS[s] : 'Усі'}
          </Button>
        ))}
      </nav>
      {result.isErr() ? (
        <p className="text-destructive">{result.error.message}</p>
      ) : (
        <InvoicesTable rows={result.value} />
      )}
    </div>
  );
}
