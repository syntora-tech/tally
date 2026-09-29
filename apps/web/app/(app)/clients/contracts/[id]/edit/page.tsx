import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getContract } from '@/server/services/clients';
import { ContractForm, type ContractFormValues } from '../../contract-form';

export const metadata: Metadata = { title: 'Редагування договору · Tally' };

type Rule = ContractFormValues['paymentDueRule'];

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getContract.run(ctx, { id });
  if (result.isErr()) notFound();
  const { contract: c, clientName, payeeName } = result.value;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Договір {c.number}</h1>
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
    </div>
  );
}
