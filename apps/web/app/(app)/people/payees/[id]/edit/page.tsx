import { notFound } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getPayee } from '@/server/services/payees';
import { PayeeForm } from '../../payee-form';
import { peopleOptions } from '../../people-options';
import { pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('editPayee');

export default async function EditPayeePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getPayee.run(ctx, { id });
  if (result.isErr()) notFound();
  const { payee } = result.value;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{payee.legalNameUa ?? payee.legalNameEn}</h1>
      <PayeeForm
        people={await peopleOptions(ctx)}
        payee={{
          id: payee.id,
          kind: payee.kind,
          legalNameUa: payee.legalNameUa,
          legalNameEn: payee.legalNameEn,
          taxId: payee.taxId,
          edrRecord: payee.edrRecord,
          edrDate: payee.edrDate,
          addressUa: payee.addressUa,
          iban: payee.iban,
          bankName: payee.bankName,
          walletAddress: payee.walletAddress,
          walletNetwork: payee.walletNetwork,
          personId: payee.personId,
          feeFixed: payee.feeFixed,
          feePercent: payee.feePercent,
          feeCurrency: payee.feeCurrency,
          feeStepFrom: payee.feeStepFrom,
          feeStepFixed: payee.feeStepFixed,
        }}
      />
    </div>
  );
}
