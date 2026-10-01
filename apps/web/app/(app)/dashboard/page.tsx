import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ALL_ROLES, FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { creditToClients } from '@/server/services/dashboard';
import { getTranslations } from 'next-intl/server';
import { getFormat, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('dashboard');

export default async function DashboardPage() {
  const ctx = await requireRole(ALL_ROLES);
  const finance = FINANCE_ROLES.includes(ctx.actor.role);
  const credit = finance ? (await creditToClients.run(ctx, {})).unwrapOr(null) : null;
  const t = await getTranslations('dashboard');
  const fmt = await getFormat();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('comingSoon')}</p>
      </div>
      {credit && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-base">{t('creditTitle')}</CardTitle>
            <CardDescription>{t('creditDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <span className="text-2xl font-semibold tabular-nums" data-testid="credit-to-clients">
              {fmt.amount(credit.totalUsd, 'USD')}
            </span>
            {credit.rows.length > 0 && (
              <ul className="text-sm text-muted-foreground">
                {credit.rows.map((r) => (
                  <li key={r.lineId}>
                    {r.personName} · {fmt.amount(r.amountUsd)} ·{' '}
                    <Link href={`/invoices/${r.invoiceId}`} className="underline">
                      {t('invoice', { number: r.invoiceNumber ?? '' })}
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
