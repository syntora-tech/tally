import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listClients } from '@/server/services/clients';
import { ClientsTable } from './clients-table';
import { getTranslations } from 'next-intl/server';
import { localizeForUser, pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';

export const generateMetadata = pageTitle('clients');

export default async function ClientsPage() {
  const ctx = await requireRole(ALL_ROLES);
  const result = await listClients.run(ctx, {});
  const canWrite = FINANCE_ROLES.includes(ctx.actor.role);
  const t = await getTranslations('clients');

  const v2 = (await getUiPrefs()).version === 'v2';
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        {v2 ? (
          <PageHeader title={t('title')} help={t('subtitle')} />
        ) : (
          <div>
            <h1 className="text-2xl font-semibold">{t('title')}</h1>
            <p className="text-muted-foreground">{t('subtitle')}</p>
          </div>
        )}
        {canWrite && <Button render={<Link href="/clients/new" />}>{t('add')}</Button>}
      </div>
      {result.isErr() ? (
        <p className="text-destructive">{(await localizeForUser(result.error)).message}</p>
      ) : (
        <ClientsTable rows={result.value} />
      )}
    </div>
  );
}
