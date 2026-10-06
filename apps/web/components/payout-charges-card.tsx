import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('personTitle')}</CardTitle>
        <p className="text-xs text-muted-foreground">{t('personHint')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {charges.unwrapOr([]).map(({ charge }) => (
          <div key={charge.id} className="flex items-end gap-2">
            <PaymentChargeForm
              target={{ personId }}
              value={charge}
              categories={expenseCategories}
              thisMonth={thisMonth}
            />
            <DeletePaymentChargeButton id={charge.id} personId={personId} />
          </div>
        ))}
        <PaymentChargeForm
          target={{ personId }}
          categories={expenseCategories}
          thisMonth={thisMonth}
        />
      </CardContent>
    </Card>
  );
}
