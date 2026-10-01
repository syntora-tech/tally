import { formatAmount } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { creditToClients } from '@/server/services/dashboard';

export const metadata: Metadata = { title: 'Огляд · Tally' };

export default async function DashboardPage() {
  const ctx = await requireRole(ALL_ROLES);
  const finance = FINANCE_ROLES.includes(ctx.actor.role);
  const credit = finance ? (await creditToClients.run(ctx, {})).unwrapOr(null) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Огляд</h1>
        <p className="text-muted-foreground">
          Залишки, дебіторка, календар дедлайнів і маржа з’являться на етапі 4
        </p>
      </div>
      {credit && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-base">Кредитуємо клієнтів</CardTitle>
            <CardDescription>
              Виплати за рахунок компанії за роботу, яку клієнт ще не оплатив
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span className="text-2xl font-semibold tabular-nums" data-testid="credit-to-clients">
              {formatAmount(credit.totalUsd, 'USD')}
            </span>
            {credit.rows.length > 0 && (
              <ul className="text-sm text-muted-foreground">
                {credit.rows.map((r) => (
                  <li key={r.lineId}>
                    {r.personName} · {formatAmount(r.amountUsd)} ·{' '}
                    <Link href={`/invoices/${r.invoiceId}`} className="underline">
                      інвойс {r.invoiceNumber}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
