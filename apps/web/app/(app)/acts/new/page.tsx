import Link from 'next/link';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { fopContracts } from '@/server/services/acts';
import { NewActForm } from '../act-forms';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { FormCard } from '@/components/v2/form-card';

export const generateMetadata = pageTitle('newAct');

export default async function NewActPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const contracts = (await fopContracts.run(ctx, {})).unwrapOr([]);
  const t = await getTranslations('act');
  const ta = await getTranslations('acts');
  const v2 = (await getUiPrefs()).version === 'v2';
  return (
    <div className="flex flex-col gap-6">
      {v2 ? (
        <PageHeader title={ta('newAct')} help={t('newSubtitle')} />
      ) : (
        <div>
          <Link href="/acts" className="text-sm text-muted-foreground hover:underline">
            {t('back')}
          </Link>
          <h1 className="text-2xl font-semibold">{ta('newAct')}</h1>
          <p className="text-muted-foreground">{t('newSubtitle')}</p>
        </div>
      )}
      <FormCard>
        <NewActForm
          today={ctx.today}
          contracts={contracts.map((c) => ({ id: c.id, label: `${c.payeeName} · ${c.number}` }))}
        />
      </FormCard>
    </div>
  );
}
