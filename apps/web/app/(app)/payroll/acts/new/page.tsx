import Link from 'next/link';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { fopContracts } from '@/server/services/acts';
import { NewActForm } from '../act-forms';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('newAct');

export default async function NewActPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const contracts = (await fopContracts.run(ctx, {})).unwrapOr([]);
  const t = await getTranslations('act');
  const ta = await getTranslations('acts');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/payroll/acts" className="text-sm text-muted-foreground hover:underline">
          {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{ta('newAct')}</h1>
        <p className="text-muted-foreground">{t('newSubtitle')}</p>
      </div>
      <NewActForm
        today={ctx.today}
        contracts={contracts.map((c) => ({ id: c.id, label: `${c.payeeName} · ${c.number}` }))}
      />
    </div>
  );
}
