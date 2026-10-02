import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listAccounts } from '@/server/services/ledger';
import { AccountForm } from '../ledger-forms';
import { getTranslations } from 'next-intl/server';
import { getFormat, pageTitle } from '@/server/i18n';

export const generateMetadata = pageTitle('accounts');

export default async function AccountsPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const accounts = (await listAccounts.run(ctx, { includeInactive: true })).unwrapOr([]);
  const t = await getTranslations('ledger');
  const fmt = await getFormat();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">{t('accounts')}</h1>
        <p className="text-muted-foreground">{t('accountsSubtitle')}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('newAccount')}</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm today={ctx.today} />
        </CardContent>
      </Card>
      {accounts.map(({ account: a, balance }) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {a.name} · {fmt.amount(balance, a.currency)}
              {!a.isActive && t('inactiveSuffix')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AccountForm
              today={ctx.today}
              value={{
                id: a.id,
                name: a.name,
                kind: a.kind,
                currency: a.currency,
                network: a.network,
                address: a.address,
                openingBalance: a.openingBalance,
                openingDate: a.openingDate,
                isActive: a.isActive,
              }}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
