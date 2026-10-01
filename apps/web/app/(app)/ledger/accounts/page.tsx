import { formatAmount } from '@tally/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listAccounts } from '@/server/services/ledger';
import { AccountForm } from '../ledger-forms';

export const metadata: Metadata = { title: 'Рахунки · Tally' };

export default async function AccountsPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const accounts = (await listAccounts.run(ctx, { includeInactive: true })).unwrapOr([]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/ledger" className="text-sm text-muted-foreground hover:underline">
          ← Ledger
        </Link>
        <h1 className="text-2xl font-semibold">Рахунки</h1>
        <p className="text-muted-foreground">
          Банк, гаманці, готівка. Валюту рахунку з проводками змінити не можна
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Новий рахунок</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountForm today={ctx.today} />
        </CardContent>
      </Card>
      {accounts.map(({ account: a, balance }) => (
        <Card key={a.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {a.name} · {formatAmount(balance, a.currency, { dp: a.kind === 'crypto' ? 6 : 2 })}
              {!a.isActive && ' · неактивний'}
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
