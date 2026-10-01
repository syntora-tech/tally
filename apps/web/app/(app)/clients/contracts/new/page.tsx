import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getClient } from '@/server/services/clients';
import { getPayee } from '@/server/services/payees';
import { ContractForm } from '../contract-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('newContract');

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; payeeId?: string }>;
}) {
  const ctx = await requireRole(FINANCE_ROLES);
  const t = await getTranslations('contracts');
  const { clientId, payeeId } = await searchParams;

  let counterpartyName: string;
  let currency = 'USD';
  if (clientId) {
    const res = await getClient.run(ctx, { id: clientId });
    if (res.isErr()) notFound();
    counterpartyName = res.value.client.shortName ?? res.value.client.legalName;
    currency = res.value.client.defaultCurrency;
  } else if (payeeId) {
    const res = await getPayee.run(ctx, { id: payeeId });
    if (res.isErr()) notFound();
    counterpartyName = res.value.payee.legalNameUa ?? res.value.payee.legalNameEn ?? '';
    currency = 'UAH';
  } else {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('newTitle')}</h1>
      <ContractForm
        counterpartyName={counterpartyName}
        contract={{
          kind: clientId ? 'client' : 'fop',
          number: '',
          signedOn: null,
          clientId: clientId ?? null,
          payeeId: payeeId ?? null,
          currency,
          paymentDueRule: { type: 'day_of_month', day: 20 },
          invoiceDateRule: { type: 'first_working_day_after_period' },
          actDateRule: { type: 'last_working_day_of_period' },
          invoiceTemplateFileId: null,
          actTemplateFileId: null,
          numberSequenceKey: null,
          status: 'active',
        }}
      />
    </div>
  );
}
