import { notFound, redirect } from 'next/navigation';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { getContractAnnex } from '@/server/services/contracts/annexes';

/** SOWs/annexes are shown on their contract's card; links to one land there. */
export default async function AnnexPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRole(FINANCE_ROLES);
  const { id } = await params;
  const result = await getContractAnnex.run(ctx, { id });
  if (result.isErr()) notFound();
  redirect(`/clients/contracts/${result.value.annex.contractId}#annex-${id}`);
}
