import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getContract } from '@/server/services/clients';
import { ContractForm, type ContractFormValues } from '../../contract-form';
import { getTranslations } from 'next-intl/server';
import { pageTitle } from '@/server/i18n';
import { getUiPrefs } from '@/server/ui-prefs';
import { PageHeader } from '@/components/v2/page-header';
import { FormCard } from '@/components/v2/form-card';

export const generateMetadata = pageTitle('editContract');

type Rule = ContractFormValues['paymentDueRule'];

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const t = await getTranslations('contracts');
  const { id } = await params;
  const result = await getContract.run(ctx, { id });
  if (result.isErr()) notFound();
  const { contract: c, clientName, payeeName } = result.value;

  const v2 = (await getUiPrefs()).version === 'v2';
  const tc = await getTranslations('common');
  return (
    <div className="flex flex-col gap-6">
      {v2 ? (
        <PageHeader
          title={t('title', { number: c.number })}
          crumb={tc('editing')}
          crumbParents={[
            c.clientId
              ? { label: clientName ?? '', href: `/clients/${c.clientId}` }
              : { label: payeeName ?? '', href: `/people/payees/${c.payeeId ?? ''}` },
            { label: c.number, href: `/clients/contracts/${c.id}` },
          ]}
        />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">{t('title', { number: c.number })}</h1>
        </>
      )}
      <FormCard>
        <ContractForm
          counterpartyName={clientName ?? payeeName ?? ''}
          contract={{
            id: c.id,
            kind: c.kind as 'client' | 'fop',
            number: c.number,
            signedOn: c.signedOn,
            clientId: c.clientId,
            payeeId: c.payeeId,
            currency: c.currency,
            paymentDueRule: c.paymentDueRule as Rule,
            invoiceDateRule: c.invoiceDateRule as Rule,
            actDateRule: c.actDateRule as Rule,
            invoiceTemplateFileId: c.invoiceTemplateFileId,
            actTemplateFileId: c.actTemplateFileId,
            numberSequenceKey: c.numberSequenceKey,
            status: c.status,
          }}
        />
      </FormCard>
    </div>
  );
}
