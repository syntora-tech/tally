import Link from 'next/link';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { transactionFormData } from '../transaction-form-data';
import { TransactionForm } from './transaction-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { FormCard } from '@/components/v2/form-card';

export const generateMetadata = pageTitle('newTransaction');

export default async function NewTransactionPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const options = await transactionFormData(ctx);
  const t = await getTranslations('newTransaction');
  const tl = await getTranslations('ledger');
  const v2 = (await getUiPrefs()).version === 'v2';
  return (
    <div className="flex flex-col gap-6">
      {v2 ? (
        <PageHeader title={tl('newTransaction')} help={t('subtitle')} />
      ) : (
        <div>
          <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
            ← Ledger
          </Link>
          <h1 className="text-2xl font-semibold">{tl('newTransaction')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
      )}
      <FormCard>
        <TransactionForm today={ctx.today} {...options} />
      </FormCard>
    </div>
  );
}
