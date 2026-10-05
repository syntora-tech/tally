import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuditHistory } from '@/components/audit-history';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getTransaction } from '@/server/services/ledger';
import { pageTitle } from '@/server/i18n';
import { TransactionForm } from '../../new/transaction-form';
import { transactionFormData } from '../../transaction-form-data';

export const generateMetadata = pageTitle('editTransaction');

export default async function EditTransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const found = await getTransaction.run(ctx, { id });
  if (found.isErr()) notFound();
  const { transaction: tx, postings, allocated } = found.value;
  const options = await transactionFormData(ctx, true);
  const t = await getTranslations('ledger');
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">{t('editTransaction')}</h1>
        {allocated && <p className="text-muted-foreground">{t('editAllocated')}</p>}
      </div>
      <TransactionForm
        today={ctx.today}
        {...options}
        value={{
          id: tx.id,
          type: tx.type,
          occurredOn: tx.occurredOn,
          categoryId: tx.categoryId,
          description: tx.description,
          counterparty: tx.counterparty,
          externalRef: tx.externalRef,
          personId: tx.personId,
          clientId: tx.clientId,
          counterpartyAddress: tx.counterpartyAddress,
          postings: postings.map((p) => ({
            accountId: p.accountId,
            amount: p.amount,
            isFee: p.isFee,
          })),
          allocated,
        }}
      />
      <AuditHistory ctx={ctx} tableName="transaction" rowId={tx.id} />
    </div>
  );
}
