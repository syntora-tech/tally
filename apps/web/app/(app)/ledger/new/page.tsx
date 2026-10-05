import Link from 'next/link';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { transactionFormData } from '../transaction-form-data';
import { TransactionForm } from './transaction-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('newTransaction');

export default async function NewTransactionPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const options = await transactionFormData(ctx);
  const t = await getTranslations('newTransaction');
  const tl = await getTranslations('ledger');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">{tl('newTransaction')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <TransactionForm today={ctx.today} {...options} />
    </div>
  );
}
