import { getTranslations } from 'next-intl/server';
import { AddDetails, CollapsibleCard } from '@/components/collapsible-card';
import { DeletePaymentChargeButton, PaymentChargeForm } from '@/components/payment-charge-forms';
import type { ServiceContext } from '@/server/services/context';
import { listCategories } from '@/server/services/ledger';
import { listPersonCharges } from '@/server/services/planned';

/** Taxes charged on every payout to a person (A-082), e.g. 20 % on top for a payee abroad. */
export async function PayoutChargesCard({
  ctx,
  personId,
}: {
  ctx: ServiceContext;
  personId: string;
}) {
  const [charges, categories, t] = await Promise.all([
    listPersonCharges.run(ctx, { personIds: [personId] }),
    listCategories.run(ctx, {}),
    getTranslations('charges'),
  ]);
  const expenseCategories = categories
    .unwrapOr([])
    .filter((c) => c.txType === 'expense')
    .map((c) => ({ value: c.id, label: c.name }));
  const thisMonth = ctx.today.slice(0, 7);
  const rows = charges.unwrapOr([]);
  return (
    <CollapsibleCard
      title={t('personTitle')}
      description={t('personHint')}
      count={rows.length}
      open={rows.length > 0}
    >
      {rows.map(({ charge }) => (
        <div key={charge.id} className="flex items-start gap-2 rounded-md border p-3">
          <div className="min-w-0 flex-1">
            <PaymentChargeForm
              target={{ personId }}
              value={charge}
              categories={expenseCategories}
              thisMonth={thisMonth}
            />
          </div>
          <DeletePaymentChargeButton id={charge.id} personId={personId} />
        </div>
      ))}
      <AddDetails label={t('add')} open={rows.length === 0}>
        <PaymentChargeForm
          target={{ personId }}
          categories={expenseCategories}
          thisMonth={thisMonth}
        />
      </AddDetails>
    </CollapsibleCard>
  );
}
