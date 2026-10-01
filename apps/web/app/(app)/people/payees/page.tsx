import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listPayees } from '@/server/services/payees';
import { PayeesTable } from './payees-table';
import { getTranslations } from 'next-intl/server';
import { localizeForUser, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('payees');

export default async function PayeesPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const result = await listPayees.run(ctx, {});
  const t = await getTranslations('payees');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button render={<Link href="/people/payees/new" />}>{t('add')}</Button>
      </div>
      {result.isErr() ? (
        <p className="text-destructive">{(await localizeForUser(result.error)).message}</p>
      ) : (
        <PayeesTable rows={result.value} />
      )}
    </div>
  );
}
