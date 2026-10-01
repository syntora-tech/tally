import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { INVOICE_STATUSES, listInvoices } from '@/server/services/invoices';
import { InvoicesTable } from './invoices-table';
import { getTranslations } from 'next-intl/server';
import { getLabels, localizeForUser, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('invoices');

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { status = '' } = await searchParams;
  const result = await listInvoices.run(ctx, { status });
  const t = await getTranslations('invoices');
  const { INVOICE_STATUS_LABELS } = await getLabels();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label={t('statusFilter')}>
        {['', ...INVOICE_STATUSES].map((s) => (
          <Button
            key={s || 'all'}
            size="sm"
            variant={s === status ? 'default' : 'outline'}
            render={<Link href={s ? `/invoices?status=${s}` : '/invoices'} />}
          >
            {s ? INVOICE_STATUS_LABELS[s] : t('all')}
          </Button>
        ))}
      </nav>
      {result.isErr() ? (
        <p className="text-destructive">{(await localizeForUser(result.error)).message}</p>
      ) : (
        <InvoicesTable rows={result.value} />
      )}
    </div>
  );
}
