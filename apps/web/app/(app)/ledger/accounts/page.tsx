import { cn } from 'cn';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FINANCE_ROLES } from '@/lib/navigation';
import { requireRole } from '@/server/request-context';
import { listAccounts } from '@/server/services/ledger';
import { AccountControls, AccountForm } from '../ledger-forms';
import { getTranslations } from 'next-intl/server';
import { getFormat, pageTitle } from '@/server/i18n';
import { DialogButton } from '@/components/v2/form-dialog';
import { Status } from '@/components/v2/status';
import { getUiPrefs } from '@/server/ui-prefs';
import { LedgerHeader } from '../ledger-v2';

export const generateMetadata = pageTitle('accounts');

export default async function AccountsPage() {
  const ctx = await requireRole(FINANCE_ROLES);
  const accounts = (await listAccounts.run(ctx, { includeInactive: true })).unwrapOr([]);
  const t = await getTranslations('ledger');
  const fmt = await getFormat();
  if ((await getUiPrefs()).version === 'v2') {
    const tc = await getTranslations('common');
    return (
      <div className="flex flex-col gap-5">
        <LedgerHeader section="accounts" help={t('v2.accountsHelp')}>
          <DialogButton title={t('newAccount')} wide content={<AccountForm today={ctx.today} />}>
            + {t('newAccount')}
          </DialogButton>
        </LedgerHeader>
        <ul className="divide-y rounded-lg border bg-card">
          {accounts.map(({ account: a, balance }, i) => (
            <li
              key={a.id}
              data-testid="account-row"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm"
            >
              <AccountControls
                id={a.id}
                name={a.name}
                hidden={a.isHidden}
                first={i === 0}
                last={i === accounts.length - 1}
              />
              <div className={cn('min-w-48 flex-1', a.isHidden && 'text-muted-foreground')}>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[
                    a.currency,
                    a.network,
                    a.address && `${a.address.slice(0, 6)}…${a.address.slice(-4)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              {a.isHidden && <Status>{t('v2.hidden')}</Status>}
              {!a.isActive && <Status>{t('v2.inactive')}</Status>}
              <span className="min-w-36 text-right font-semibold tabular-nums">
                {fmt.amount(balance, a.currency)}
              </span>
              <DialogButton
                variant="ghost"
                title={`${tc('edit')}: ${a.name}`}
                wide
                content={
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
                }
              >
                {tc('edit')}
              </DialogButton>
            </li>
          ))}
          {accounts.length === 0 && (
            <li className="px-4 py-10 text-center text-muted-foreground">{t('v2.noAccounts')}</li>
          )}
        </ul>
      </div>
    );
  }
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
